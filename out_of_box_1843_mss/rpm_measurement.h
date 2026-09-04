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
#define RPM_DEFAULT_BLADE_RADIUS_M      0.10f   /* Fan blade radius in meters (e.g. 0.10 m = 10 cm) */
#define RPM_DEFAULT_ASPECT_ANGLE_DEG    0.0f    /* Angle between radar line-of-sight & fan rotation plane (deg) */

/**************************************************************************
 * Algorithm Tuning Parameters
 **************************************************************************/

/**
 * @brief Minimum range bin to examine.
 *        Bins 0 and 1 are ignored to avoid TX-to-RX direct antenna coupling and near-field leakage.
 */
#define RPM_MIN_RANGE_BIN               2U

/**
 * @brief SNR multiplier above local range-bin noise floor to distinguish rotating blades from background.
 */
#define RPM_SNR_THRESHOLD_RATIO         1.35f

/**
 * @brief Minimum peak magnitude threshold to consider a rotating target present.
 */
#define RPM_MIN_VALID_MAGNITUDE         80U

/**
 * @brief Exponential Moving Average (EMA) smoothing factor for live RPM output.
 *        alpha in [0.0, 1.0]. A value of 0.20 provides smooth, stable display while rapidly tracking speed changes.
 */
#define RPM_EMA_ALPHA                   0.20f

/**
 * @brief Output formatting mode for UART:
 *        0: Sends "RPM: 1250.4\r\n"
 *        1: Sends "1250.4\r\n" (raw numeric output suitable for direct graphing/parsing)
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
    float       rpmRaw;         /* Instantaneous unfiltered RPM from the current frame */
    float       tipVelocity;    /* Extracted physical blade tip velocity in m/s */
    float       peakVelocity;   /* Velocity corresponding to the strongest blade reflection facet in m/s */
    int32_t     dopplerBin;     /* Signed Doppler bin of the strongest blade return */
    uint16_t    rangeBin;       /* Range bin index where the rotating fan was localized */
    uint16_t    magnitude;      /* Peak magnitude at detected Doppler frequency */
    bool        isFanDetected;  /* True if a rotating fan is actively detected in the current frame */
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
 * @param[out] result             Pointer to structure receiving measurement metrics
 */
void RPM_calculateFromDetMatrix(
    uint16_t* detMatrix,
    uint16_t numRangeBins,
    uint16_t numDopplerBins,
    float dopplerResolution,
    FanRpmResult_t *result
);

#endif /* RPM_MEASUREMENT_H */
