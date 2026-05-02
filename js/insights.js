import { average, sortEntriesByDateDesc } from "./utils.js";

const PLATTER_ADVICE = {
  "Focus time": "Try one distraction-free block each day — even 25 minutes of deep work helps the brain form stronger connections and builds cognitive stamina.",
  "Playtime": "Schedule something spontaneous or creative this week — a game, a creative project, or anything playful and new helps the brain adapt and innovate.",
  "Connecting": "Reach out to someone meaningful. A short walk with a friend or a genuine conversation helps the brain feel safe, supported, and regulated.",
  "Physical (Exercise)": "Even a 10-minute walk counts. Gentle aerobic movement lifts mood and cognitive clarity — you don't need a full workout to feel the benefit.",
  "Reflection": "Build a brief daily pause — journalling, meditation, or quiet prayer for 5–10 minutes strengthens emotional regulation and self-awareness.",
  "Downtime": "Protect unscheduled time where your mind can wander freely. Avoid filling every gap with screens or tasks — mental rest restores focus and creativity.",
  "Nutrition": "Fuel your brain with regular balanced meals. Consistent meal timing and reducing ultra-processed food helps stabilise energy and mood throughout the day."
};

export function buildInsights(entries) {
  const ordered = sortEntriesByDateDesc(entries);
  const latest7 = ordered.slice(0, 7);
  const latest3 = ordered.slice(0, 3);
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

  const platterAverages7 = platterFields
    .map(({ key, label }) => {
      const vals = latest7.map((e) => e[key]).filter((v) => Number.isFinite(v));
      const avg = average(vals);
      return avg !== null ? { label, avg } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.avg - b.avg);

  const platterAverages3 = platterFields
    .map(({ key, label }) => {
      const vals = latest3.map((e) => e[key]).filter((v) => Number.isFinite(v));
      const avg = average(vals);
      return avg !== null ? { label, avg } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.avg - b.avg);

  // Prefer last 3 days for platter priorities when there's enough data
  const plattersForPriority = latest3.length >= 2 ? platterAverages3 : platterAverages7;
  const lowestPlatter = platterAverages7.length ? platterAverages7[0] : null;

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
      sleepAvg,
      lowSleepFatigue,
      highSleepFatigue,
      plattersForPriority,
      recentDays: latest3.length,
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
  if (metrics.sampleSize < 3) {
    return "Add a few more days of entries to start seeing personalised patterns and suggestions.";
  }

  const parts = [];

  // ── Fatigue trend ──────────────────────────────────────────────────────────
  if (metrics.fatigueAvg !== null) {
    let line;
    if (metrics.fatigueAvg >= 7) {
      line = metrics.previousFatigue !== null && metrics.fatigueAvg > metrics.previousFatigue + 0.5
        ? `Fatigue is high (avg ${metrics.fatigueAvg.toFixed(1)}/10) and trending upward — worth taking seriously. Prioritise rest and reduce demands where possible.`
        : `Fatigue is elevated this week (avg ${metrics.fatigueAvg.toFixed(1)}/10). The suggestions below are especially important right now.`;
    } else if (metrics.fatigueAvg >= 4.5) {
      line = metrics.previousFatigue !== null && metrics.fatigueAvg < metrics.previousFatigue - 0.5
        ? `Fatigue is moderate (avg ${metrics.fatigueAvg.toFixed(1)}/10) and improving — you're heading in the right direction.`
        : `Fatigue is moderate this week (avg ${metrics.fatigueAvg.toFixed(1)}/10). Small consistent improvements in the areas below can make a real difference.`;
    } else {
      line = `Fatigue is low this week (avg ${metrics.fatigueAvg.toFixed(1)}/10) — the habits keeping you here are worth protecting.`;
    }
    parts.push(`<strong>Fatigue this week:</strong> ${line}`);
  }

  // ── Sleep ──────────────────────────────────────────────────────────────────
  if (metrics.sleepAvg !== null) {
    let line;
    if (metrics.sleepAvg < 5) {
      line = `Sleep quality is critically low (avg ${metrics.sleepAvg.toFixed(1)}/10). This is likely a primary driver of fatigue — consistent wind-down routines, a cool dark room, and avoiding screens an hour before bed are the highest-leverage changes you can make. Consider speaking to a healthcare professional if this persists.`;
    } else if (metrics.sleepAvg < 7) {
      line = `Sleep quality is below ideal (avg ${metrics.sleepAvg.toFixed(1)}/10). Protecting 7–9 hours with a consistent wake time — even on weekends — can meaningfully reduce fatigue over time.`;
    } else if (metrics.sleepAvg < 8.5) {
      line = `Sleep quality is reasonable (avg ${metrics.sleepAvg.toFixed(1)}/10). A consistent sleep schedule will help maintain this.`;
    } else {
      line = `Sleep quality is strong (avg ${metrics.sleepAvg.toFixed(1)}/10) — keep protecting it.`;
    }
    if (metrics.lowSleepFatigue !== null && metrics.highSleepFatigue !== null &&
        metrics.lowSleepFatigue > metrics.highSleepFatigue + 0.8) {
      line += ` Your data confirms it: fatigue is noticeably higher on lower-sleep days, making sleep your single biggest lever.`;
    }
    parts.push(`<strong>Sleep:</strong> ${line}`);
  }

  // ── Platter priorities ─────────────────────────────────────────────────────
  const dayLabel = metrics.recentDays >= 3 ? "recent days" : "this week";
  const priorities = metrics.plattersForPriority.slice(0, 3).filter((p) => p.avg < 6.5);

  if (priorities.length) {
    const items = priorities.map((p) => {
      const advice = PLATTER_ADVICE[p.label] || "Look for small, consistent ways to invest in this area each day.";
      return `<li><strong>${p.label}</strong> (avg ${p.avg.toFixed(1)}/10) — ${advice}</li>`;
    }).join("");
    parts.push(`<strong>Platter priorities based on your ${dayLabel}:</strong><ul>${items}</ul>`);
  } else if (metrics.plattersForPriority.length) {
    const lowest = metrics.plattersForPriority[0];
    parts.push(`<strong>Platter priorities:</strong> Your platter looks well balanced. <strong>${lowest.label}</strong> is your lowest area (avg ${lowest.avg.toFixed(1)}/10) — keep giving it some attention.`);
  }

  return parts.length ? parts.join("<br><br>") : "Keep logging daily entries to start seeing personalised insights.";
}
