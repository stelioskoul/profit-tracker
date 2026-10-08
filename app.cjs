const express = require("express");
const app = express();
app.disable("x-powered-by");
// The build bundles the audited adapter and its SPA HTML before deployment.
app.use(require("./dist/vercel-api.cjs"));
module.exports = app;
