const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.get('/', (req, res) => {
  res.send('Lucky Game сервер работает!');
});

// ======================
// Хранилище
// ======================
const players = {};           // id -> { balance, name }
let crashHistory = [];        // последние 10 множителей

// ======================
// РАКЕТА (CRASH)
// ======================
let crashState = {
  status: 'waiting',          // waiting | flying | crashed
  multiplier: 1.00,
  crashPoint: 0,
  bets: {},                   // socketId -> { amount, autoCashout, cashedOut }
  startTime: null
};

function generateCrashPoint() {
  // Чаще падает около 1.5x, редко до 4-6x
  const r = Math.random();
  if (r < 0.55) return +(1.01 + Math.random() * 0.7).toFixed(2);      // 1.01 - 1.71
  if (r < 0.85) return +(1.72 + Math.random() * 1.5).toFixed(2);      // 1.72 - 3.22
  if (r < 0.97) return +(3.23 + Math.random() * 1.5).toFixed(2);      // 3.23 - 4.73
  return +(4.74 + Math.random() * 1.3).toFixed(2);                    // 4.74 - 6.04
}

function startCrashRound() {
  crashState.status = 'flying';
  crashState.multiplier = 1.00;
  crashState.crashPoint = generateCrashPoint();
  crashState.bets = {};
  crashState.startTime = Date.now();

  io.emit('crash:start', { crashPoint: crashState.crashPoint });

  const interval = setInterval(() => {
    if (crashState.status !== 'flying') {
      clearInterval(interval);
      return;
    }

    crashState.multiplier = +(crashState.multiplier + 0.01).toFixed(2);

    io.emit('crash:tick', { multiplier: crashState.multiplier });

    if (crashState.multiplier >= crashState.crashPoint) {
      clearInterval(interval);
      crashState.status = 'crashed';

      // Сохраняем историю
      crashHistory.unshift(crashState.crashPoint);
      if (crashHistory.length > 10) crashHistory.pop();

      io.emit('crash:crashed', { 
        crashPoint: crashState.crashPoint,
        history: crashHistory 
      });

      // Через 3 секунды новый раунд
      setTimeout(startCrashRound, 3000);
    }
  }, 100);
}

// Запускаем ракету сразу
startCrashRound();

// ======================
// SOCKET.IO
// ======================
io.on('connection', (socket) => {
  console.log('Игрок подключился:', socket.id);

  // Регистрация игрока
  socket.on('player:join', (data) => {
    players[socket.id] = {
      balance: 1000,          // стартовый баланс
      name: data.name || 'Игрок'
    };
    socket.emit('player:info', players[socket.id]);
    socket.emit('crash:history', crashHistory);
  });

  // Ставка в ракету
  socket.on('crash:bet', (data) => {
    const player = players[socket.id];
    if (!player) return;

    const amount = Number(data.amount);
    if (amount < 10 || amount > player.balance) {
      socket.emit('error', { message: 'Недостаточно средств или ставка меньше 10' });
      return;
    }

    if (crashState.status !== 'flying' && crashState.status !== 'waiting') {
      socket.emit('error', { message: 'Сейчас нельзя ставить' });
      return;
    }

    player.balance -= amount;
    crashState.bets[socket.id] = {
      amount,
      autoCashout: data.autoCashout || null,
      cashedOut: false
    };

    socket.emit('player:info', player);
    socket.emit('crash:betAccepted', { amount });
  });

  // Ручной вывод в ракете
  socket.on('crash:cashout', () => {
    const bet = crashState.bets[socket.id];
    const player = players[socket.id];
    if (!bet || bet.cashedOut || crashState.status !== 'flying') return;

    bet.cashedOut = true;
    const win = Math.floor(bet.amount * crashState.multiplier);
    player.balance += win;

    socket.emit('crash:cashedOut', { 
      multiplier: crashState.multiplier, 
      win 
    });
    socket.emit('player:info', player);
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    console.log('Игрок отключился:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
