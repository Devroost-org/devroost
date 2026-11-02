const express = require('express');

const app = express();
const port = Number(process.env.PORT || 3000);

app.get('/', (_req, res) => {
  res.send('Devroost Node example is running.');
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.listen(port, '0.0.0.0');
