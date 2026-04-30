import { average, sortEntriesByDateDesc } from "./utils.js";

export function buildInsights(entries) {
  const ordered = sortEntriesByDateDesc(entries);
  const latest7 = ordered.slice(0, 7);
  const previous7 = ordered.slice(7, 14);

  const fatigue7 = latest7.map((e) => e.fatigue).filter((v) => Number.isFinite(v));
  const sleep7 = latest7.map((e) => e.sleepQuality).filter((v) => Number.isFinite(v));

  const fatigueAvg = average(fatigue7);
  const sleepAvg = average(sleep7);
  const previousFatigue = average(previous7.map((e) => e.fatigue).filter((v) => Number.isFinite(v)));

  const platterFields = [
    { key: "focus", label: "Focus time" },
    { key: "play", label: "Playtime" },
    { key: "connecting", label: "Connecting" },
    { key: "physical", label: "Physical (Exercise)" },
    { key: "reflect", label: "Reflection" },
    { key: "down", label: "Downtime" },
    { key: "nutrition", label: "Nutrition" }
  ];
  const platterAverages = platterFields
    .map(({ key, label }) => {
      const vals = latest7.map((e) => e[key]).filter((v) => Number.isFinite(v));
      const avg = average(vals);
      return avg !== null ? { label, avg } : null;
    })
    .filter(Boolean);
  platterAverages.sort((a, b) => a.avg - b.avg);
  const lowestPlatter = platterAverages.length ? platterAverages[0] : null;

  const withExercise = latest7.filter((e) => Number.isFinite(e.exerciseMins) && e.exerciseMins > 0 && Number.isFinite(e.fatigue));
  const noExercise = latest7.filter((e) => (!Number.isFinite(e.exerciseMins) || e.exerciseMins === 0) && Number.isFinite(e.fatigue));

  const withExerciseAvg = average(withExercise.map((e) => e.fatigue));
  const noExerciseAvg = average(noExercise.map((e) => e.fatigue));

  const sleepLow = latest7.filter((e) => Number.isFinite(e.sleepQuality) && e.sleepQuality <= 6 && Number.isFinite(e.fatigue));
  const sleepHigh = latest7.filter((e) => Number.isFinite(e.sleepQuality) && e.sleepQuality >= 8 && Number.isFinite(e.fatigue));

  const lowSleepFatigue = average(sleepLow.map((e) => e.fatigue));
  const highSleepFatigue = average(sleepHigh.map((e) => e.fatigue));

  return {
    cards: [
      { label: "7-Day Fatigue Avg", value: formatScore(fatigueAvg) },
      { label: "7-Day Sleep Avg", value: formatScore(sleepAvg) },
      { label: "Lowest Platter", value: lowestPlatter ? `${lowestPlatter.label} (${lowestPlatter.avg.toFixed(1)})` : "-" },
      { label: "Fatigue vs Prior Week", value: deltaText(fatigueAvg, previousFatigue) }
    ],
    narrative: createNarrative({
      fatigueAvg,
      previousFatigue,
      withExerciseAvg,
      noExerciseAvg,
      lowSleepFatigue,
      highSleepFatigue,
      sampleSize: latest7.length
    })
  };
}

function formatScore(value) {
  return value === null ? "-" : value.toFixed(1);
}

function deltaText(current, previous) {
  if (current === null || previous === null) {
    return "Not enough data";
  }
  const diff = current - previous;
  if (Math.abs(diff) < 0.2) {
    return "Stable";
  }
  return `${diff > 0 ? "+" : ""}${diff.toFixed(1)} points`;
}

function createNarrative(metrics) {
  if (metrics.sampleSize < 4) {
    return "Add a few more days of entries to unlock stronger fatigue pattern detection.";
  }

  const statements = [];

  if (metrics.fatigueAvg !== null && metrics.previousFatigue !== null) {
    if (metrics.fatigueAvg > metrics.previousFatigue + 0.5) {
      statements.push("Fatigue is trending higher than the prior week.");
    } else if (metrics.fatigueAvg < metrics.previousFatigue - 0.5) {
      statements.push("Fatigue is improving compared with the prior week.");
    }
  }

  if (metrics.lowSleepFatigue !== null && metrics.highSleepFatigue !== null) {
    if (metrics.lowSleepFatigue > metrics.highSleepFatigue + 0.6) {
      statements.push("Lower sleep-quality days are consistently followed by higher fatigue.");
    }
  }

  if (metrics.withExerciseAvg !== null && metrics.noExerciseAvg !== null) {
    if (metrics.withExerciseAvg + 0.4 < metrics.noExerciseAvg) {
      statements.push("Days with exercise appear to reduce fatigue by the next check-in.");
    } else if (metrics.withExerciseAvg > metrics.noExerciseAvg + 0.4) {
      statements.push("Recent exercise days coincide with higher fatigue; intensity or recovery may need adjustment.");
    }
  }

  if (!statements.length) {
    statements.push("No strong fatigue driver stood out this week; keep logging to improve confidence.");
  }

  return `${statements.join(" ")} Suggested focus: protect sleep quality and keep notes specific on stressors.`;
}
