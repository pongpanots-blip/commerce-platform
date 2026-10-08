// read-only: show the TLS certificate josh's origin (joshapp.io → 172.31.40.34 via extra_hosts) presents to commerce
const tls = require("tls");
const host = "joshapp.io";
const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
  const c = s.getPeerCertificate();
  console.log(JSON.stringify({ connectedTo: s.remoteAddress, authorized: s.authorized, authorizationError: s.authorizationError, subject: c.subject && c.subject.CN, issuer: c.issuer && (c.issuer.O + " " + c.issuer.CN), valid_from: c.valid_from, valid_to: c.valid_to, san: c.subjectaltname }, null, 1));
  s.end();
});
s.on("error", (e) => { console.error("tls error:", e.message); process.exit(1); });
