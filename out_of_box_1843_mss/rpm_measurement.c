#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <math.h>
#include <ti/common/sys_common.h>

#include "rpm_measurement.h"

#define PI_FLOAT                3.141592653589793f
#define DEG_TO_RAD              (PI_FLOAT / 180.0f)
/* Conversion factor: Q8 log2 magnitude units to dB.
 * 256 Q8 units = 1 bit of log2 = 6.0205999 dB.
 * 1 Q8 unit = 6.0205999 / 256.0 = 0.02351796875 dB */
#define Q8_TO_DB                0.02351796875f

/**************************************************************************
 * Static State Variables (Temporal Smoothing Filter)
 **************************************************************************/
static float gRpmSmoothed       = 0.0f;
static bool  gRpmInitialized    = false;

/**
 * @brief  Initializes / resets the RPM measurement filter states.
 */
void RPM_init(void)
{
    gRpmSmoothed    = 0.0f;
    gRpmInitialized = false;
}

/**
 * @brief  Performs sub-bin parabolic interpolation around a peak Doppler bin.
 *
 * @param[in] ym1  Log-magnitude at bin (d - 1)
 * @param[in] y0   Log-magnitude at peak bin (d)
 * @param[in] yp1  Log-magnitude at bin (d + 1)
 *
 * @return Fractional bin offset in [-0.5, +0.5]
 */
static float RPM_parabolicInterpolation(float ym1, float y0, float yp1)
{
    float denominator = 2.0f * (2.0f * y0 - ym1 - yp1);
    float delta;

    if (fabsf(denominator) > 1e-4f)
    {
        delta = (yp1 - ym1) / denominator;
        if (delta > 0.5f)
        {
            delta = 0.5f;
        }
        else if (delta < -0.5f)
        {
            delta = -0.5f;
        }
    }
    else
    {
        delta = 0.0f;
    }

    return delta;
}

/**
 * @brief  Extracts high-accuracy fan RPM from the 2D Range-Doppler detection matrix.
 *
 * Algorithm Pipeline:
 *  1. Excess-Energy Range Localization: Finds range bin with excess moving Doppler energy above its noise floor.
 *  2. Log-Domain SNR Thresholding: Additive delta in Q8 log2 scale (+160 units = +3.76 dB SNR).
 *  3. Symmetric Doppler Envelope Extraction: Detects positive and negative Doppler boundaries (blade tips).
 *  4. DC & Low-Speed Clutter Rejection: Skips Doppler bin 1 (< 0.66 m/s, human breathing / stationary clutter).
 *  5. Sub-Bin Parabolic Interpolation: Achieves fractional Doppler bin resolution.
 *  6. Linear Tip Velocity to Rotational RPM conversion using blade radius and radar aspect angle.
 *  7. Temporal Exponential Moving Average (EMA) filter for stable live reading.
 */
void RPM_calculateFromDetMatrix(
    uint16_t* detMatrix,
    uint16_t numRangeBins,
    uint16_t numDopplerBins,
    float dopplerResolution,
    float rangeResolution,
    FanRpmResult_t *result)
{
    uint16_t r;
    uint16_t d;
    int32_t  zeroDopplerBin;
    uint16_t bestRangeBin;
    uint32_t maxExcessEnergy;
    uint32_t bestSliceNoise;
    uint16_t detectionThreshold;
    uint16_t peakVal;
    int32_t  peakDopplerBin;
    int32_t  posEdgeBin;
    int32_t  negEdgeBin;
    float    effectiveTipBin;
    float    subBinOffset;
    float    tipVelocity;
    float    peakVelocity;
    float    cosAngle;
    float    effectiveRadius;
    float    rpmInstantaneous;
    float    snrDb;

    if ((detMatrix == NULL) || (result == NULL) || (numRangeBins <= RPM_MIN_RANGE_BIN) || (numDopplerBins < 8))
    {
        return;
    }

    zeroDopplerBin  = (int32_t)(numDopplerBins / 2);
    bestRangeBin    = RPM_MIN_RANGE_BIN;
    maxExcessEnergy = 0;
    bestSliceNoise  = 0;

    /*-------------------------------------------------------------------------
     * STEP 1: Automatic Fan Range Bin Localization
     * For each range bin, estimate its local noise floor (excluding DC & edges).
     * Then accumulate only the excess energy from moving Doppler bins that
     * clearly rise above that local noise floor (> 1.5 dB / 64 Q8 units).
     * This robustly pinpoints the spinning fan without being misled by
     * range bins with high thermal noise.
     *------------------------------------------------------------------------*/
    for (r = RPM_MIN_RANGE_BIN; r < numRangeBins; r++)
    {
        uint32_t rOffset = (uint32_t)r * (uint32_t)numDopplerBins;
        uint32_t noiseSum = 0;
        uint16_t noiseCount = 0;
        uint32_t sliceNoise;
        uint32_t sliceExcessEnergy = 0;

        /* First pass: average noise across Doppler bins (skipping DC and DC-adjacent leakage) */
        for (d = RPM_MIN_DOPPLER_BIN; d <= (uint16_t)(numDopplerBins - RPM_MIN_DOPPLER_BIN); d++)
        {
            if ((d == (uint16_t)zeroDopplerBin) ||
                (d == (uint16_t)(zeroDopplerBin - 1)) ||
                (d == (uint16_t)(zeroDopplerBin + 1)))
            {
                continue;
            }
            noiseSum += (uint32_t)detMatrix[rOffset + d];
            noiseCount++;
        }

        if (noiseCount == 0)
        {
            continue;
        }

        sliceNoise = noiseSum / noiseCount;

        /* Second pass: accumulate excess energy above (sliceNoise + 64) (~1.5 dB SNR) */
        for (d = RPM_MIN_DOPPLER_BIN; d <= (uint16_t)(numDopplerBins - RPM_MIN_DOPPLER_BIN); d++)
        {
            if ((d == (uint16_t)zeroDopplerBin) ||
                (d == (uint16_t)(zeroDopplerBin - 1)) ||
                (d == (uint16_t)(zeroDopplerBin + 1)))
            {
                continue;
            }
            if ((uint32_t)detMatrix[rOffset + d] > (sliceNoise + 64U))
            {
                sliceExcessEnergy += ((uint32_t)detMatrix[rOffset + d] - sliceNoise);
            }
        }

        if (sliceExcessEnergy > maxExcessEnergy)
        {
            maxExcessEnergy = sliceExcessEnergy;
            bestRangeBin    = r;
            bestSliceNoise  = sliceNoise;
        }
    }

    /* Fallback noise floor if no moving excess energy was found */
    if (bestSliceNoise == 0)
    {
        uint32_t fanOffset = (uint32_t)bestRangeBin * (uint32_t)numDopplerBins;
        uint32_t noiseSum = 0;
        uint16_t noiseCount = 0;
        for (d = RPM_MIN_DOPPLER_BIN; d <= (uint16_t)(numDopplerBins - RPM_MIN_DOPPLER_BIN); d++)
        {
            noiseSum += (uint32_t)detMatrix[fanOffset + d];
            noiseCount++;
        }
        bestSliceNoise = (noiseCount > 0) ? (noiseSum / noiseCount) : 1000U;
    }

    /*-------------------------------------------------------------------------
     * STEP 2: Log-Domain Thresholding
     * Detection matrix is in Q8 log2 scale: 256 units = 6.02 dB.
     * Additive delta: detectionThreshold = bestSliceNoise + RPM_SNR_THRESHOLD_DELTA_Q8.
     *------------------------------------------------------------------------*/
    detectionThreshold = (uint16_t)(bestSliceNoise + RPM_SNR_THRESHOLD_DELTA_Q8);
    if (detectionThreshold < RPM_MIN_VALID_MAGNITUDE)
    {
        detectionThreshold = RPM_MIN_VALID_MAGNITUDE;
    }

    /*-------------------------------------------------------------------------
     * STEP 3: Peak Magnitude and Doppler Envelope Detection
     * Scan positive Doppler bins (d = RPM_MIN_DOPPLER_BIN to zeroDopplerBin - 1)
     * and negative Doppler bins (d = zeroDopplerBin + 1 to numDopplerBins - RPM_MIN_DOPPLER_BIN).
     *------------------------------------------------------------------------*/
    peakVal        = 0;
    peakDopplerBin = 0;
    posEdgeBin     = 0;
    negEdgeBin     = 0;

    {
        uint32_t fanOffset = (uint32_t)bestRangeBin * (uint32_t)numDopplerBins;

        /* Scan Positive Doppler bins (approaching blade tip) */
        for (d = RPM_MIN_DOPPLER_BIN; d < (uint16_t)zeroDopplerBin; d++)
        {
            uint16_t val = detMatrix[fanOffset + d];
            if (val > peakVal)
            {
                peakVal = val;
                peakDopplerBin = (int32_t)d;
            }
            if (val >= detectionThreshold)
            {
                posEdgeBin = (int32_t)d; /* Retains highest positive bin above threshold */
            }
        }

        /* Scan Negative Doppler bins (receding blade tip) */
        for (d = (uint16_t)zeroDopplerBin + 1; d <= (uint16_t)(numDopplerBins - RPM_MIN_DOPPLER_BIN); d++)
        {
            uint16_t val = detMatrix[fanOffset + d];
            int32_t signedD = (int32_t)d - (int32_t)numDopplerBins;

            if (val > peakVal)
            {
                peakVal = val;
                peakDopplerBin = signedD;
            }
            if (val >= detectionThreshold)
            {
                if ((negEdgeBin == 0) || (signedD < negEdgeBin))
                {
                    negEdgeBin = signedD; /* Retains largest negative magnitude bin above threshold */
                }
            }
        }
    }

    /* Calculate SNR in dB relative to localized slice noise floor */
    if (peakVal > (uint16_t)bestSliceNoise)
    {
        snrDb = ((float)peakVal - (float)bestSliceNoise) * Q8_TO_DB;
    }
    else
    {
        snrDb = -1.0f * (((float)bestSliceNoise - (float)peakVal) * Q8_TO_DB);
    }

    /* Populate diagnostic range and SNR metrics */
    result->rangeBin   = bestRangeBin;
    result->distanceM  = (float)bestRangeBin * rangeResolution;
    result->magnitude  = peakVal;
    result->noiseFloor = (uint16_t)bestSliceNoise;
    result->snrDb      = snrDb;

    /* Check if target signal is sufficiently above background noise */
    if ((peakVal < detectionThreshold) || (maxExcessEnergy == 0))
    {
        /* Fan not detected or stopped: smooth decay to zero */
        gRpmSmoothed *= (1.0f - RPM_EMA_ALPHA);
        if (gRpmSmoothed < 5.0f)
        {
            gRpmSmoothed = 0.0f;
        }

        result->rpm           = gRpmSmoothed;
        result->rpmRaw        = 0.0f;
        result->tipVelocity   = 0.0f;
        result->peakVelocity  = 0.0f;
        result->dopplerBin    = 0;
        result->isFanDetected = false;
        return;
    }

    /*-------------------------------------------------------------------------
     * STEP 4: Determine Representative Blade Tip Doppler Bin
     * Rotating fan blades have symmetric approaching and receding extents.
     * Use envelope edges if available; fallback to peak reflection facet.
     *------------------------------------------------------------------------*/
    if ((posEdgeBin > 0) && (negEdgeBin < 0))
    {
        /* Both edges detected: average their absolute values to cancel DC/sensor bias */
        effectiveTipBin = 0.5f * ((float)posEdgeBin + (float)(-negEdgeBin));
    }
    else if (posEdgeBin > 0)
    {
        effectiveTipBin = (float)posEdgeBin;
    }
    else if (negEdgeBin < 0)
    {
        effectiveTipBin = (float)(-negEdgeBin);
    }
    else
    {
        effectiveTipBin = fabsf((float)peakDopplerBin);
    }

    /*-------------------------------------------------------------------------
     * STEP 5: Sub-Bin Parabolic Interpolation
     * Refine integer peak Doppler bin for sub-bin resolution.
     *------------------------------------------------------------------------*/
    subBinOffset = 0.0f;
    {
        uint32_t fanOffset = (uint32_t)bestRangeBin * (uint32_t)numDopplerBins;
        int32_t rawPeakIdx = (peakDopplerBin >= 0) ? peakDopplerBin : (peakDopplerBin + (int32_t)numDopplerBins);

        if ((rawPeakIdx > 1) && (rawPeakIdx < ((int32_t)numDopplerBins - 1)) &&
            (rawPeakIdx != (zeroDopplerBin - 1)) && (rawPeakIdx != zeroDopplerBin) &&
            (rawPeakIdx != (zeroDopplerBin + 1)))
        {
            float ym1 = (float)detMatrix[fanOffset + (rawPeakIdx - 1)];
            float y0  = (float)detMatrix[fanOffset + rawPeakIdx];
            float yp1 = (float)detMatrix[fanOffset + (rawPeakIdx + 1)];
            subBinOffset = RPM_parabolicInterpolation(ym1, y0, yp1);
        }
    }

    /* Calculate physical velocities with sub-bin precision */
    tipVelocity  = (effectiveTipBin + fabsf(subBinOffset)) * dopplerResolution;
    peakVelocity = ((float)peakDopplerBin + subBinOffset) * dopplerResolution;

    /*-------------------------------------------------------------------------
     * STEP 6: Convert Blade Tip Velocity to Rotational RPM
     *
     * Physics:
     *   v_tip = omega * R * cos(aspectAngle)
     *   omega = 2 * PI * (RPM / 60)
     *
     *   RPM = (60 * v_tip) / (2 * PI * R * cos(aspectAngle))
     *------------------------------------------------------------------------*/
    cosAngle = cosf(RPM_DEFAULT_ASPECT_ANGLE_DEG * DEG_TO_RAD);
    if (cosAngle < 0.1f)
    {
        cosAngle = 1.0f; /* Safety fallback */
    }

    effectiveRadius = RPM_DEFAULT_BLADE_RADIUS_M * cosAngle;
    if (effectiveRadius > 0.001f)
    {
        rpmInstantaneous = (60.0f * tipVelocity) / (2.0f * PI_FLOAT * effectiveRadius);
    }
    else
    {
        rpmInstantaneous = 0.0f;
    }

    /*-------------------------------------------------------------------------
     * STEP 7: Exponential Moving Average (EMA) Filter
     * Stabilizes live display output against frame-to-frame turbulence.
     *------------------------------------------------------------------------*/
    if (!gRpmInitialized)
    {
        gRpmSmoothed    = rpmInstantaneous;
        gRpmInitialized = true;
    }
    else
    {
        gRpmSmoothed = (RPM_EMA_ALPHA * rpmInstantaneous) + ((1.0f - RPM_EMA_ALPHA) * gRpmSmoothed);
    }

    /* Populate Result Structure */
    result->rpm           = gRpmSmoothed;
    result->rpmRaw        = rpmInstantaneous;
    result->tipVelocity   = tipVelocity;
    result->peakVelocity  = peakVelocity;
    result->dopplerBin    = peakDopplerBin;
    result->isFanDetected = true;
}

