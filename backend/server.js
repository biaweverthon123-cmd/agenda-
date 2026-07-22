const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const projectRoot = path.resolve(__dirname, '..');
const frontendRoot = path.join(projectRoot, 'frontend');
const historyRoot = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)
  : path.join(__dirname, 'data', 'history');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 100000) reject(new Error('Corpo da requisição muito grande.'));
  });
  req.on('end', () => {
    try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('JSON inválido.')); }
  });
  req.on('error', reject);
});

const monthFromDate = (date) => {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
};

const historyFile = (month) => path.join(historyRoot, `${month}.json`);

const readHistory = async (month) => {
  try {
    return JSON.parse(await fs.readFile(historyFile(month), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const writeHistory = async (month, records) => {
  await fs.mkdir(historyRoot, { recursive: true });
  const target = historyFile(month);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
};

const handleApi = async (req, res, url) => {
  if (url.pathname === '/api/history' && req.method === 'GET') {
    const year = url.searchParams.get('year');
    const month = url.searchParams.get('month');
    if (!/^\d{4}$/.test(year || '') || !/^(0[1-9]|1[0-2])$/.test(month || '')) {
      sendJson(res, 400, { error: 'Informe o ano e o mês.' });
      return;
    }
    sendJson(res, 200, await readHistory(`${year}-${month}`));
    return;
  }

  if (url.pathname === '/api/appointments' && req.method === 'POST') {
    const payload = await readBody(req);
    const month = monthFromDate(payload.date);
    const time = String(payload.time || '');
    const reminder = String(payload.reminder || '').trim();
    if (!month || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      sendJson(res, 400, { error: 'Data ou horário inválido.' });
      return;
    }
    const records = await readHistory(month);
    const appointment = { id: randomUUID(), date: payload.date, time, reminder, createdAt: new Date().toISOString() };
    records.push(appointment);
    await writeHistory(month, records);
    sendJson(res, 201, appointment);
    return;
  }

  const appointmentMatch = url.pathname.match(/^\/api\/appointments\/([a-f0-9-]+)$/i);

  if (appointmentMatch && req.method === 'PUT') {
    const payload = await readBody(req);
    const originalMonth = monthFromDate(payload.originalDate);
    const destinationMonth = monthFromDate(payload.date);
    const time = String(payload.time || '');
    const reminder = String(payload.reminder || '').trim();
    if (!originalMonth || !destinationMonth || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      sendJson(res, 400, { error: 'Data ou horário inválido.' });
      return;
    }
    const sourceRecords = await readHistory(originalMonth);
    const recordIndex = sourceRecords.findIndex(item => item.id === appointmentMatch[1]);
    if (recordIndex === -1) {
      sendJson(res, 404, { error: 'Agendamento não encontrado.' });
      return;
    }
    const current = sourceRecords[recordIndex];
    const updatedAppointment = { ...current, date: payload.date, time, reminder, updatedAt: new Date().toISOString() };
    if (originalMonth === destinationMonth) {
      sourceRecords[recordIndex] = updatedAppointment;
      await writeHistory(originalMonth, sourceRecords);
    } else {
      const destinationRecords = await readHistory(destinationMonth);
      destinationRecords.push(updatedAppointment);
      await writeHistory(destinationMonth, destinationRecords);
      sourceRecords.splice(recordIndex, 1);
      await writeHistory(originalMonth, sourceRecords);
    }
    sendJson(res, 200, updatedAppointment);
    return;
  }

  if (appointmentMatch && req.method === 'DELETE') {
    const month = monthFromDate(url.searchParams.get('date'));
    if (!month) {
      sendJson(res, 400, { error: 'Informe a data do agendamento.' });
      return;
    }
    const records = await readHistory(month);
    const updated = records.filter(item => item.id !== appointmentMatch[1]);
    if (updated.length === records.length) {
      sendJson(res, 404, { error: 'Agendamento não encontrado.' });
      return;
    }
    await writeHistory(month, updated);
    sendJson(res, 200, { success: true });
    return;
  }

  sendJson(res, 404, { error: 'Rota não encontrada.' });
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    const relativePath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = path.resolve(frontendRoot, relativePath);
    if (!filePath.startsWith(`${frontendRoot}${path.sep}`)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') { res.writeHead(404); res.end('Not found'); return; }
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Erro interno no servidor.' });
  }
});

server.listen(port, host, () => {
  console.log(`Agenda disponível em http://localhost:${port}/`);
  console.log(`Históricos mensais em ${historyRoot}`);
});
