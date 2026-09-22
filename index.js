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
const players = {};
let crashHistory = [];

// ======================
// РАКЕТА (CRASH)
// ======================
let crashState = {
  status: 'waiting',          // waiting | flying | crashed
  multiplier: 1.00,
  crashPoint: 0,
  bets: {},
  timeLeft: 5                 // секунд до старта
};

function generateCrashPoint() {
  const r = Math.random();
  if (r < 0.55) return +(1.01 + Math.random() * 0.7).toFixed(2);
  if (r < 0.85) return +(1.72 + Math.random() * 1.5).toFixed(2);
  if (r < 0.97) return +(3.23 + Math.random() * 1.5).toFixed(2);
  return +(4.74 + Math.random() * 1.3).toFixed(2);
}

function startWaiting() {
  crashState.status = 'waiting';
  crashState.multiplier = 1.00;
  crashState.bets = {};
  crashState.timeLeft = 5;

  io.emit('crash:waiting', { timeLeft: crashState.timeLeft });

  const timer = setInterval(() => {
    crashState.timeLeft--;
    io.emit('crash:timer', { timeLeft: crashState.timeLeft });

    if (crashState.timeLeft <= 0) {
      clearInterval(timer);
      startFlying();
    }
  }, 1000);
}

function startFlying() {
  crashState.status = 'flying';
  crashState.multiplier = 1.00;
  crashState.crashPoint = generateCrashPoint();

  io.emit('crash:start', { crashPoint: crashState.crashPoint });

  const interval = setInterval(() => {
    if (crashState.status !== 'flying') {
      clearInterval(interval);
      return;
    }

    crashState.multiplier = +(crashState.multiplier + 0.01).toFixed(2);
    io.emit('crash:tick', { multiplier: crashState.multiplier });

    // Автовывод
    for (const [id, bet] of Object.entries(crashState.bets)) {
      if (!bet.cashedOut && bet.autoCashout && crashState.multiplier >= bet.autoCashout) {
        bet.cashedOut = true;
        const player = players[id];
        if (player) {
          const win = Math.floor(bet.amount * bet.autoCashout);
          player.balance += win;
          io.to(id).emit('crash:cashedOut', {
            multiplier: bet.autoCashout,
            win
          });
          io.to(id).emit('player:info', player);
        }
      }
    }

    if (crashState.multiplier >= crashState.crashPoint) {
      clearInterval(interval);
      crashState.status = 'crashed';

      crashHistory.unshift(crashState.crashPoint);
      if (crashHistory.length > 10) crashHistory.pop();

      io.emit('crash:crashed', {
        crashPoint: crashState.crashPoint,
        history: crashHistory
      });

      setTimeout(startWaiting, 3500);
    }
  }, 100);
}

// Запускаем первый цикл
startWaiting();

// ======================
// SOCKET.IO
// ======================
io.on('connection', (socket) => {
  console.log('Игрок подключился:', socket.id);

  socket.on('player:join', (data) => {
    players[socket.id] = {
      balance: 0,
      name: data.name || 'Игрок'
    };
    socket.emit('player:info', players[socket.id]);
    socket.emit('crash:history', crashHistory);
    socket.emit('crash:waiting', { timeLeft: crashState.timeLeft });
  });

  socket.on('crash:bet', (data) => {
    const player = players[socket.id];
    if (!player) return;

    const amount = Number(data.amount);
    let auto = Number(data.autoCashout);

    if (isNaN(auto) || auto < 1.1) auto = null;
    if (auto > 10) auto = 10;

    if (amount < 10 || amount > player.balance) {
      socket.emit('error', { message: 'Недостаточно средств или ставка меньше 10' });
      return;
    }

    if (crashState.status !== 'waiting') {
      socket.emit('error', { message: 'Сейчас нельзя ставить. Ждите следующий раунд' });
      return;
    }

    player.balance -= amount;
    crashState.bets[socket.id] = {
      amount,
      autoCashout: auto,
      cashedOut: false
    };

    socket.emit('player:info', player);
    socket.emit('crash:betAccepted', { amount });
  });

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
