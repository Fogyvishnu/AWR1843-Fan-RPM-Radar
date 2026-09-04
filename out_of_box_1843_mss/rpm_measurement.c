#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <math.h>
#include <ti/common/sys_common.h>

#include "rpm_measurement.h"

#define PI_FLOAT                3.141592653589793f
#define DEG_TO_RAD              (PI_FLOAT / 180.0f)

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
 *  1. Dynamic Range Bin Localization: Scans non-zero Doppler energy to find range bin with the fan.
 *  2. Noise Floor & CFAR Thresholding: Computes local range-slice noise floor and dynamic threshold.
 *  3. Symmetric Doppler Envelope Extraction: Detects positive and negative Doppler boundaries (blade tips).
 *  4. Sub-Bin Parabolic Interpolation: Achieves fractional Doppler bin resolution.
 *  5. Linear Tip Velocity to Rotational RPM conversion using blade radius and radar aspect angle.
 *  6. Temporal Exponential Moving Average (EMA) filter for stable live reading.
 */
void RPM_calculateFromDetMatrix(
    uint16_t* detMatrix,
    uint16_t numRangeBins,
    uint16_t numDopplerBins,
    float dopplerResolution,
    FanRpmResult_t *result)
{
    uint16_t r;
    uint16_t d;
    int32_t  zeroDopplerBin;
    uint16_t bestRangeBin;
    uint32_t maxMovingEnergy;
    uint32_t noiseSum;
    uint16_t noiseCount;
    uint16_t avgNoiseFloor;
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

    if ((detMatrix == NULL) || (result == NULL) || (numRangeBins <= RPM_MIN_RANGE_BIN) || (numDopplerBins < 4))
    {
        return;
    }

    zeroDopplerBin  = (int32_t)(numDopplerBins / 2);
    bestRangeBin    = 0;
    maxMovingEnergy = 0;

    /*-------------------------------------------------------------------------
     * STEP 1: Automatic Fan Range Bin Localization
     * Identify the range bin containing the fan by finding the maximum non-zero
     * Doppler energy (ignores stationary clutter like walls and tables).
     *------------------------------------------------------------------------*/
    for (r = RPM_MIN_RANGE_BIN; r < numRangeBins; r++)
    {
        uint32_t rangeMovingEnergy = 0;
        uint32_t rOffset = (uint32_t)r * (uint32_t)numDopplerBins;

        for (d = 1; d < numDopplerBins; d++)
        {
            if (d == (uint16_t)zeroDopplerBin)
            {
                continue;
            }
            rangeMovingEnergy += (uint32_t)detMatrix[rOffset + d];
        }

        if (rangeMovingEnergy > maxMovingEnergy)
        {
            maxMovingEnergy = rangeMovingEnergy;
            bestRangeBin = r;
        }
    }

    /*-------------------------------------------------------------------------
     * STEP 2: Noise Floor & Dynamic Threshold Estimation
     * Compute average noise level across the fan's range slice.
     *------------------------------------------------------------------------*/
    noiseSum   = 0;
    noiseCount = 0;
    {
        uint32_t fanOffset = (uint32_t)bestRangeBin * (uint32_t)numDopplerBins;
        for (d = 1; d < numDopplerBins; d++)
        {
            if (d == (uint16_t)zeroDopplerBin)
            {
                continue;
            }
            noiseSum += (uint32_t)detMatrix[fanOffset + d];
            noiseCount++;
        }
    }

    avgNoiseFloor = (noiseCount > 0) ? (uint16_t)(noiseSum / noiseCount) : 0;
    detectionThreshold = (uint16_t)((float)avgNoiseFloor * RPM_SNR_THRESHOLD_RATIO);
    if (detectionThreshold < RPM_MIN_VALID_MAGNITUDE)
    {
        detectionThreshold = RPM_MIN_VALID_MAGNITUDE;
    }

    /*-------------------------------------------------------------------------
     * STEP 3: Peak Magnitude and Doppler Envelope Detection
     * Find strongest peak and outer spectral edges (positive and negative tips).
     *------------------------------------------------------------------------*/
    peakVal        = 0;
    peakDopplerBin = 0;
    posEdgeBin     = 0;
    negEdgeBin     = 0;

    {
        uint32_t fanOffset = (uint32_t)bestRangeBin * (uint32_t)numDopplerBins;

        /* Scan Positive Doppler bins: d = 1 to (N/2 - 1) */
        for (d = 1; d < (uint16_t)zeroDopplerBin; d++)
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

        /* Scan Negative Doppler bins: d = (N/2 + 1) to (N - 1) */
        for (d = (uint16_t)zeroDopplerBin + 1; d < numDopplerBins; d++)
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

    /* Check if target signal is sufficiently above background noise */
    if ((peakVal < detectionThreshold) || (maxMovingEnergy == 0))
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
        result->rangeBin      = bestRangeBin;
        result->magnitude     = peakVal;
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
            (rawPeakIdx != (zeroDopplerBin - 1)) && (rawPeakIdx != zeroDopplerBin))
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
    result->rangeBin      = bestRangeBin;
    result->magnitude     = peakVal;
    result->isFanDetected = true;
}
