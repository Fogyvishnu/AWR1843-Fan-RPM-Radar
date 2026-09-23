#ifndef RPM_MEASUREMENT_H
#define RPM_MEASUREMENT_H

#include <stdint.h>
#include <stdbool.h>

/**************************************************************************
 * Fan Setup Configuration Parameters
 **************************************************************************/

/**
 * @brief Default physical parameters of the target fan.
 *        Users can adjust these to match their specific fan setup.
 */
#define RPM_DEFAULT_NUM_BLADES          3U      /* Number of fan blades */
#define RPM_DEFAULT_BLADE_RADIUS_M      0.60f   /* Fan blade radius in meters (0.60 m for ceiling fan) */
#define RPM_DEFAULT_ASPECT_ANGLE_DEG    30.0f   /* Default angle between radar line-of-sight & fan rotation plane (deg) */

/**
 * @brief Calibration multiplier factor (K_cal).
 *        Accounts for the effective scattering center (R_eff vs R_tip) along the blade.
 *        Because the wide blade bracket/root reflects ~15 dB stronger than the thin aerodynamic tip,
 *        the radar reflection centroid is at ~0.28m rather than the 0.60m outer tip.
 *        A factor of 2.10x maps the measured ~55 RPM -> 115-120 RPM (Low) and ~165 RPM -> 350 RPM (High).
 */
#define RPM_CALIBRATION_SCALE_FACTOR    2.10f

/**************************************************************************
 * Algorithm Tuning Parameters
 **************************************************************************/

/**
 * @brief Minimum range bin to examine.
 *        Bins 0 and 1 are ignored to avoid TX-to-RX direct antenna coupling and near-field leakage (~8 cm).
 */
#define RPM_MIN_RANGE_BIN               2U

/**
 * @brief Minimum Doppler bin to examine (absolute index).
 *        Bins 0 and 1 are ignored to avoid DC stationary clutter leakage (ceiling, hub, walls)
 *        and slow human breathing / body swaying (~0.3-0.6 m/s, which falsely registers as ~10 RPM).
 */
#define RPM_MIN_DOPPLER_BIN             2U

/**
 * @brief SNR threshold delta in Q8 log2 magnitude units above local range-slice noise floor.
 *        In TI mmWave HWA, 256 Q8 units = 6.02 dB (1 bit of log2).
 *        160 Q8 units corresponds to ~3.76 dB SNR above noise floor.
 *        This reliably captures thin ceiling fan blades without false triggers on thermal noise.
 */
#define RPM_SNR_THRESHOLD_DELTA_Q8      160U    /* ~3.76 dB SNR */

/**
 * @brief Minimum peak magnitude in Q8 format to consider a rotating target present.
 *        In HWA 2D-FFT log2 format, typical receiver noise floor is ~1800-2400 Q8 units.
 */
#define RPM_MIN_VALID_MAGNITUDE         1200U

/**
 * @brief Exponential Moving Average (EMA) smoothing factor for live RPM output.
 *        alpha in [0.0, 1.0]. A value of 0.20 provides smooth, stable display while rapidly tracking speed changes.
 */
#define RPM_EMA_ALPHA                   0.20f

/**
 * @brief Output formatting mode for UART:
 *        0: Sends "RPM: %.1f | RUNNING | Dist: %.2fm | SNR: %.1fdB | TipVel: %.1fm/s\r\n"
 *        1: Sends "%.1f\r\n" (raw numeric output suitable for direct graphing/parsing)
 */
#define RPM_UART_NUMERIC_ONLY           0

/**************************************************************************
 * Data Structures
 **************************************************************************/

/**
 * @brief Structure containing complete RPM and Doppler measurement results.
 */
typedef struct {
    float       rpm;            /* Filtered, stabilized live RPM sent over UART */
    float       rpmRaw;         /* Instantaneous unfiltered RPM from current frame */
    float       tipVelocity;    /* Extracted physical blade tip velocity in m/s */
    float       peakVelocity;   /* Velocity corresponding to strongest blade reflection in m/s */
    float       snrDb;          /* Peak signal-to-noise ratio in dB above slice noise floor */
    float       distanceM;      /* Physical distance to the localized fan in meters */
    int32_t     dopplerBin;     /* Signed Doppler bin of the strongest blade return */
    uint16_t    rangeBin;       /* Range bin index where the rotating fan was localized */
    uint16_t    magnitude;      /* Peak magnitude at detected Doppler frequency (Q8 format) */
    uint16_t    noiseFloor;     /* Local noise floor in Q8 format */
    bool        isFanDetected;  /* True if a rotating fan is actively detected in current frame */
} FanRpmResult_t;

/**************************************************************************
 * Public Function Declarations
 **************************************************************************/

/**
 * @brief  Initializes or resets the internal states of the RPM measurement engine.
 */
void RPM_init(void);

/**
 * @brief  Processes the 2D Range-Doppler detection matrix to extract high-accuracy fan RPM.
 *
 * @param[in]  detMatrix          Pointer to 2D Detection Matrix (uint16_t array from DSP/HWA)
 * @param[in]  numRangeBins       Total number of 1D FFT range bins
 * @param[in]  numDopplerBins     Total number of 2D FFT Doppler bins
 * @param[in]  dopplerResolution  Doppler resolution step in m/s per Doppler bin
 * @param[in]  rangeResolution    Range resolution step in meters per range bin
 * @param[out] result             Pointer to structure receiving measurement metrics
 */
void RPM_calculateFromDetMatrix(
    uint16_t* detMatrix,
    uint16_t numRangeBins,
    uint16_t numDopplerBins,
    float dopplerResolution,
    float rangeResolution,
    FanRpmResult_t *result
);

#endif /* RPM_MEASUREMENT_H */

