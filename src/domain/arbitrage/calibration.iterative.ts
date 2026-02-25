export interface CalibrationSample {
  amountDecimal: number;
  diff: number | null;
}

export interface CalibrationRunnerParams<T extends CalibrationSample> {
  initialSample: T;
  evaluate: (amountDecimal: number) => Promise<T | null>;
  toleranceAbs: number;
  minDecimal: number;
  maxIterations: number;
  expandLimit: number;
  recordSample: (sample: T) => void;
  preferSample: (current: T | null, candidate: T | null) => T | null;
}

export interface CalibrationRunnerResult<T extends CalibrationSample> {
  finalSample: T;
  bestSample: T | null;
  lowSample: T | null;
  highSample: T | null;
  evaluations: number;
}

export async function runCalibrationLoop<T extends CalibrationSample>(
  params: CalibrationRunnerParams<T>,
): Promise<CalibrationRunnerResult<T>> {
  const {
    initialSample,
    evaluate,
    toleranceAbs,
    minDecimal,
    maxIterations,
    expandLimit,
    recordSample,
    preferSample,
  } = params;

  let bestSample: T | null = preferSample(null, initialSample);

  const initialDiff = initialSample.diff;
  if (initialDiff == null || Math.abs(initialDiff) <= toleranceAbs) {
    return {
      finalSample: initialSample,
      bestSample,
      lowSample: initialDiff != null && initialDiff <= 0 ? initialSample : null,
      highSample: initialDiff != null && initialDiff >= 0 ? initialSample : null,
      evaluations: 1,
    };
  }

  let evaluations = 1;
  let lowSample: T | null = initialDiff < 0 ? initialSample : null;
  let highSample: T | null = initialDiff > 0 ? initialSample : null;
  let lowDecimal = initialDiff < 0 ? initialSample.amountDecimal : initialSample.amountDecimal;
  let highDecimal = initialDiff > 0 ? initialSample.amountDecimal : initialSample.amountDecimal;

  const evaluateAndRecord = async (amountDecimal: number): Promise<T | null> => {
    const sample = await evaluate(amountDecimal);
    if (sample) {
      recordSample(sample);
      bestSample = preferSample(bestSample, sample);
      evaluations += 1;
    }
    return sample;
  };

  if (initialDiff < 0) {
    let candidateDecimal = initialSample.amountDecimal;
    for (let expansions = 0; expansions < expandLimit && evaluations < maxIterations; expansions += 1) {
      candidateDecimal *= 2;
      const sample = await evaluateAndRecord(candidateDecimal);
      if (!sample) break;
      const sampleDiff = sample.diff;
      if (sampleDiff == null) break;
      if (Math.abs(sampleDiff) <= toleranceAbs) {
        return {
          finalSample: sample,
          bestSample,
          lowSample: sampleDiff <= 0 ? sample : lowSample,
          highSample: sampleDiff >= 0 ? sample : highSample,
          evaluations,
        };
      }
      if (sampleDiff >= 0) {
        highSample = sample;
        highDecimal = candidateDecimal;
        break;
      }
      lowSample = sample;
      lowDecimal = candidateDecimal;
    }
  } else {
    let candidateDecimal = initialSample.amountDecimal;
    for (let contractions = 0; contractions < expandLimit && evaluations < maxIterations; contractions += 1) {
      candidateDecimal /= 2;
      if (candidateDecimal < minDecimal) break;
      const sample = await evaluateAndRecord(candidateDecimal);
      if (!sample) break;
      const sampleDiff = sample.diff;
      if (sampleDiff == null) break;
      if (Math.abs(sampleDiff) <= toleranceAbs) {
        return {
          finalSample: sample,
          bestSample,
          lowSample: sampleDiff <= 0 ? sample : lowSample,
          highSample: sampleDiff >= 0 ? sample : highSample,
          evaluations,
        };
      }
      if (sampleDiff <= 0) {
        lowSample = sample;
        lowDecimal = candidateDecimal;
        break;
      }
      highSample = sample;
      highDecimal = candidateDecimal;
    }
  }

  if (!lowSample || !highSample) {
    return {
      finalSample: bestSample ?? initialSample,
      bestSample,
      lowSample,
      highSample,
      evaluations,
    };
  }

  while (evaluations < maxIterations) {
    const midDecimal = (lowDecimal + highDecimal) / 2;
    if (!Number.isFinite(midDecimal) || midDecimal <= 0) break;
    if (Math.abs(highDecimal - lowDecimal) < minDecimal) break;

    const sample = await evaluateAndRecord(midDecimal);
    if (!sample) break;
    const sampleDiff = sample.diff;
    if (sampleDiff != null && Math.abs(sampleDiff) <= toleranceAbs) {
      return {
        finalSample: sample,
        bestSample,
        lowSample: sampleDiff <= 0 ? sample : lowSample,
        highSample: sampleDiff >= 0 ? sample : highSample,
        evaluations,
      };
    }
    if (sampleDiff == null) break;
    if (sampleDiff > 0) {
      highSample = sample;
      highDecimal = midDecimal;
    } else {
      lowSample = sample;
      lowDecimal = midDecimal;
    }
  }

  const finalSample = bestSample ?? highSample ?? lowSample ?? initialSample;
  return {
    finalSample,
    bestSample,
    lowSample,
    highSample,
    evaluations,
  };
}
