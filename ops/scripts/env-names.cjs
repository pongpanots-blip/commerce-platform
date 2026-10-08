// SCRIPT_ARGS: 'NAME1 NAME2 …' — prints only whether each env name is set (non-empty) in the platform container.
// Never prints a value. Names must look like env keys.
const names = (process.env.SCRIPT_ARGS || "").trim().split(/\s+/).filter(Boolean);
if (!names.length || names.some((n) => !/^[A-Z][A-Z0-9_]{1,63}$/.test(n))) { console.error("SCRIPT_ARGS must be env NAMES"); process.exit(1); }
const out = Object.fromEntries(names.map((n) => [n, Boolean((process.env[n] || "").trim())]));
console.log("env names present:", JSON.stringify(out));
if (Object.values(out).some((v) => !v)) process.exitCode = 1;
