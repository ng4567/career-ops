// Presentational styling for the "Job Me" web app.
//
// The CSS lives here, separate from the markup and client JS in renderHomePage
// (server.mjs), so the page structure stays clean. High-impact look: animated
// gradient backdrop, glassmorphism cards with glow, big gradient hero, gradient
// buttons with hover lift, and staggered entrance animations.

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">`;

const STYLES = `
:root {
  --ink: #160f2e;
  --muted: #6b6394;
  --card: rgba(255, 255, 255, 0.62);
  --card-border: rgba(255, 255, 255, 0.7);
  --line: rgba(124, 92, 214, 0.18);
  --brand: #7c3aed;
  --brand2: #4f46e5;
  --accent: #ec4899;
  --cyan: #06b6d4;
  --ring: rgba(124, 58, 237, 0.28);
  --radius: 22px;
  --shadow: 0 24px 60px -28px rgba(76, 29, 149, 0.5);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
@keyframes drift {
  0%   { background-position: 0% 0%, 100% 0%, 50% 100%, 0 0; }
  50%  { background-position: 100% 50%, 0% 100%, 30% 0%, 0 0; }
  100% { background-position: 0% 0%, 100% 0%, 50% 100%, 0 0; }
}
@keyframes rise {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes glowpulse {
  0%, 100% { transform: scale(1); box-shadow: 0 14px 40px -10px rgba(124, 58, 237, 0.6); }
  50%      { transform: scale(1.04); box-shadow: 0 20px 52px -8px rgba(236, 72, 153, 0.6); }
}
body {
  font-family: 'Inter', system-ui, -apple-system, Segoe UI, Arial, sans-serif;
  margin: 0;
  color: var(--ink);
  min-height: 100vh;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  background:
    radial-gradient(1100px 700px at 8% -8%, rgba(124, 58, 237, 0.42), transparent 60%),
    radial-gradient(1000px 650px at 100% 0%, rgba(236, 72, 153, 0.4), transparent 58%),
    radial-gradient(1000px 800px at 50% 120%, rgba(6, 182, 212, 0.32), transparent 60%),
    linear-gradient(160deg, #f5f3ff 0%, #fdf2f8 55%, #eff6ff 100%);
  background-size: 200% 200%, 200% 200%, 200% 200%, 100% 100%;
  background-attachment: fixed;
  animation: drift 26s ease-in-out infinite;
}
.wrap { max-width: 940px; margin: 0 auto; padding: 40px 22px 96px; }

/* Header */
.hero { text-align: center; padding: 34px 0 26px; animation: rise .7s ease both; }
.brand { display: inline-flex; align-items: center; gap: 16px; font-family: 'Sora', 'Inter', sans-serif; font-weight: 800; letter-spacing: -0.03em; }
.brand .logo {
  width: 60px; height: 60px; border-radius: 18px;
  display: grid; place-items: center;
  background: linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%);
  color: #fff; font-size: 30px;
  animation: glowpulse 4.5s ease-in-out infinite;
}
.brand .name {
  font-size: 48px; line-height: 1;
  background: linear-gradient(110deg, var(--brand) 0%, var(--accent) 50%, var(--brand2) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.tagline { color: var(--muted); margin: 18px auto 0; font-size: 16.5px; max-width: 54ch; font-weight: 500; }

/* Cards */
section {
  position: relative;
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  padding: 30px 30px 28px;
  margin-bottom: 24px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  animation: rise .7s ease both;
}
section:nth-of-type(1) { animation-delay: .05s; }
section:nth-of-type(2) { animation-delay: .14s; }
section:nth-of-type(3) { animation-delay: .23s; }
section::before {
  content: ""; position: absolute; inset: 0; border-radius: var(--radius); padding: 1px;
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.55), rgba(236, 72, 153, 0.35), rgba(6, 182, 212, 0.4));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  pointer-events: none; opacity: .9;
}
section > h2 {
  display: flex; align-items: center; gap: 13px;
  font-family: 'Sora', 'Inter', sans-serif;
  font-size: 23px; font-weight: 800; letter-spacing: -0.02em;
  margin: 0 0 6px;
}
.badge {
  width: 38px; height: 38px; flex: none; border-radius: 13px;
  display: grid; place-items: center; font-size: 19px; color: #fff;
  background: linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%);
  box-shadow: 0 10px 22px -10px rgba(124, 58, 237, 0.7);
}
.sub { color: var(--muted); font-size: 14px; margin: 4px 0 18px; font-weight: 500; }
.block { padding-top: 22px; margin-top: 22px; border-top: 1px dashed var(--line); }
.block:first-of-type { padding-top: 0; margin-top: 0; border-top: none; }
.block-title { font-weight: 800; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 6px; color: var(--brand); font-family: 'Sora', 'Inter', sans-serif; }

label { display: block; font-weight: 600; font-size: 13px; margin: 16px 0 6px; color: #4a3f78; }
input, textarea {
  width: 100%; padding: 12px 14px; font: inherit; color: var(--ink);
  background: rgba(255, 255, 255, 0.78); border: 1px solid var(--line); border-radius: 13px;
  transition: border-color .16s ease, box-shadow .16s ease, background .16s ease;
}
input::placeholder, textarea::placeholder { color: #a99fce; }
input:focus, textarea:focus {
  outline: none; border-color: var(--brand);
  box-shadow: 0 0 0 4px var(--ring); background: #fff;
}
textarea { min-height: 130px; resize: vertical; }

button {
  position: relative; overflow: hidden;
  margin-top: 16px; padding: 12px 22px; cursor: pointer; font: inherit; font-weight: 700; font-size: 14px;
  color: #fff; border: none; border-radius: 13px;
  background: linear-gradient(135deg, var(--brand) 0%, var(--brand2) 50%, var(--accent) 130%);
  box-shadow: 0 14px 30px -12px rgba(124, 58, 237, 0.65);
  transition: transform .12s ease, box-shadow .18s ease, filter .18s ease;
}
button::after {
  content: ""; position: absolute; top: 0; left: -120%; width: 80%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.45), transparent);
  transform: skewX(-18deg); transition: left .55s ease;
}
button:hover { transform: translateY(-2px); box-shadow: 0 22px 40px -14px rgba(236, 72, 153, 0.6); filter: brightness(1.05); }
button:hover::after { left: 130%; }
button:active { transform: translateY(0); }
button:disabled { opacity: .5; cursor: not-allowed; filter: grayscale(.3); box-shadow: none; }
button:disabled::after { display: none; }
button.ghost {
  background: rgba(255, 255, 255, 0.6); color: var(--brand); border: 1px solid var(--card-border);
  box-shadow: none; backdrop-filter: blur(6px);
}
button.ghost::after { display: none; }
button.ghost:hover { background: #fff; border-color: var(--brand); transform: translateY(-1px); filter: none; }
.btn-row { display: flex; flex-wrap: wrap; gap: 11px; }

pre {
  background: rgba(22, 15, 46, 0.92); color: #eee9ff; padding: 18px; border-radius: 16px;
  overflow: auto; white-space: pre-wrap; font-size: 12.5px;
  font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace; margin-top: 16px;
  border: 1px solid rgba(124, 58, 237, 0.4); box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
}
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 600px) {
  .row { grid-template-columns: 1fr; }
  .brand .name { font-size: 38px; }
  .wrap { padding: 28px 16px 72px; }
}
.muted { color: var(--muted); font-size: 13px; }
code { background: rgba(124, 58, 237, 0.1); border-radius: 6px; padding: 1px 6px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; color: var(--brand); }
#companyStatus, #scanStatus, #discoverStatus { margin-top: 12px; }

.job {
  border: 1px solid var(--line); border-radius: 15px; padding: 15px 17px; margin: 11px 0;
  background: rgba(255, 255, 255, 0.66); transition: transform .14s ease, border-color .16s ease, box-shadow .16s ease;
  backdrop-filter: blur(8px);
}
.job:hover { transform: translateY(-2px); border-color: rgba(124, 58, 237, 0.4); box-shadow: 0 16px 34px -18px rgba(124, 58, 237, 0.55); }
.job h3 { margin: 0 0 4px; font-size: 15.5px; font-weight: 700; font-family: 'Sora', 'Inter', sans-serif; }
.job .meta { color: var(--muted); font-size: 13px; margin-bottom: 6px; }
.job .result { font-size: 13px; margin-top: 8px; }
.job button { margin-top: 10px; padding: 8px 15px; font-size: 13px; }
.job a { color: var(--brand2); font-weight: 700; text-decoration: none; }
.job a:hover { text-decoration: underline; }
.scanlog {
  margin-top: 10px; font-family: ui-monospace, Consolas, monospace; font-size: 12px;
  color: #e0d8ff; background: rgba(42, 31, 82, 0.92); padding: 12px 14px; border-radius: 13px;
  max-height: 170px; overflow: auto; border: 1px solid rgba(124, 58, 237, 0.45);
}
.foot { text-align: center; color: var(--muted); font-size: 12.5px; margin-top: 38px; }
`;

export function themeFonts() {
  return FONTS;
}

export function themeStyles() {
  return STYLES;
}
