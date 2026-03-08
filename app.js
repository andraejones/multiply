(function () {
  'use strict';

  const STORAGE_KEY = 'multiply-trainer';
  const FAST_THRESHOLD = 5000; // ms

  // --- State ---
  let data;
  let session = {
    correct: 0,
    total: 0,
    streak: 0,
    timerSeconds: 0,
    timerInterval: null,
    currentFact: null,
    previousFact: null,
    problemStartTime: 0,
    paused: false,
    wrongFacts: [],
  };

  // --- Defaults ---
  function defaults() {
    return {
      facts: {},
      settings: { timerMinutes: 5 },
      history: {},
      dailyStreak: 0,
      lastPracticeDate: null,
      personalBest: 0,
    };
  }

  // --- LocalStorage ---
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const base = defaults();
        data = {
          ...base,
          ...parsed,
          settings: { ...base.settings, ...(parsed.settings || {}) },
          facts: parsed.facts || {},
          history: parsed.history || {},
        };
      } else {
        data = defaults();
      }
    } catch {
      data = defaults();
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // silently fail
    }
  }

  // --- Facts ---
  function canonicalKey(a, b) {
    return a <= b ? a + 'x' + b : b + 'x' + a;
  }

  function initFacts() {
    for (let a = 1; a <= 12; a++) {
      for (let b = a; b <= 12; b++) {
        const key = a + 'x' + b;
        if (!data.facts[key]) {
          data.facts[key] = { weight: 5, correct: 0, attempts: 0, streak: 0, bestStreak: 0 };
        }
      }
    }
    saveData();
  }

  // --- Screens ---
  function showScreen(name) {
    document.querySelectorAll('section').forEach(function (s) {
      s.classList.remove('active');
    });
    document.getElementById(name).classList.add('active');
  }

  // --- Weighted Random Pick ---
  function pickNextFact() {
    const keys = Object.keys(data.facts);
    let totalWeight = 0;
    for (let i = 0; i < keys.length; i++) {
      totalWeight += data.facts[keys[i]].weight;
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      let rand = Math.random() * totalWeight;
      for (let i = 0; i < keys.length; i++) {
        rand -= data.facts[keys[i]].weight;
        if (rand <= 0) {
          if (attempt < 3 && keys[i] === session.previousFact) {
            break; // re-pick
          }
          return keys[i];
        }
      }
    }
    // fallback
    return keys[Math.floor(Math.random() * keys.length)];
  }

  // --- Problem Display ---
  function nextProblem() {
    const key = pickNextFact();
    session.currentFact = key;
    session.previousFact = key;

    const parts = key.split('x').map(Number);
    let a = parts[0], b = parts[1];
    // Randomly swap order
    if (Math.random() < 0.5) {
      const tmp = a; a = b; b = tmp;
    }

    document.getElementById('problem-display').textContent = a + ' × ' + b;
    document.querySelector('.answer-area').style.display = '';
    document.getElementById('next-btn').style.display = 'none';
    const input = document.getElementById('answer-input');
    input.value = '';
    input.focus();
    session.problemStartTime = Date.now();

    // Clear feedback
    const fb = document.getElementById('feedback');
    fb.textContent = '';
    fb.className = 'feedback';
  }

  // --- Submit ---
  function submitAnswer() {
    const input = document.getElementById('answer-input');

    if (session.waitingForConfirm) return;

    const value = parseInt(input.value, 10);
    if (isNaN(value)) return;

    const key = session.currentFact;
    const parts = key.split('x').map(Number);
    const correctAnswer = parts[0] * parts[1];
    const elapsed = Date.now() - session.problemStartTime;
    session.totalTime += elapsed;
    const fact = data.facts[key];
    const fb = document.getElementById('feedback');

    fact.attempts++;
    session.total++;

    var lostStreak = session.streak;

    if (value === correctAnswer) {
      fact.correct++;
      fact.streak++;
      if (fact.streak > fact.bestStreak) fact.bestStreak = fact.streak;

      if (elapsed <= FAST_THRESHOLD) {
        fact.weight = Math.max(1, fact.weight - 1);
      }
      // slow correct: weight unchanged

      session.correct++;
      session.streak++;

      fb.textContent = getCorrectMessage();
      fb.className = 'feedback correct';
    } else {
      fact.weight += 3;
      fact.streak = 0;
      session.streak = 0;

      if (!session.wrongFacts.includes(key)) {
        session.wrongFacts.push(key);
      }

      fb.textContent = correctAnswer + '  — ' + parts[0] + ' × ' + parts[1] + ' = ' + correctAnswer;
      fb.className = 'feedback wrong';
    }

    document.getElementById('streak-display').textContent = session.streak + ' 🔥';
    document.getElementById('session-score').textContent = session.correct + ' correct';

    saveData();

    if (value === correctAnswer) {
      setTimeout(function () {
        if (session.timerSeconds > 0 || session.paused) {
          nextProblem();
        }
      }, 400);
    } else if (lostStreak >= 3) {
      // Show streak-broken interstitial, then show the wrong-answer review
      showStreakBroken(lostStreak, function () {
        session.waitingForConfirm = true;
        document.querySelector('.answer-area').style.display = 'none';
        document.getElementById('next-btn').style.display = '';
      });
    } else {
      // No streak to break — just show wrong-answer review
      session.waitingForConfirm = true;
      document.querySelector('.answer-area').style.display = 'none';
      document.getElementById('next-btn').style.display = '';
    }
  }

  function getCorrectMessage() {
    const s = session.streak;
    if (s === 20) return 'UNSTOPPABLE! 20 in a row!';
    if (s === 15) return 'INCREDIBLE! 15 streak!';
    if (s === 10) return 'AMAZING! 10 in a row!';
    if (s === 5) return 'GREAT! 5 in a row!';
    const msgs = ['Correct!', 'Nice!', 'Yes!', 'Got it!', 'Right!'];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }

  // --- Streak Broken Interstitial ---
  var streakMessages = [
    { emoji: '💪', msg: 'Shake it off!' },
    { emoji: '🌟', msg: 'You\'ve got this!' },
    { emoji: '🚀', msg: 'Keep going!' },
    { emoji: '🔥', msg: 'Light it up again!' },
    { emoji: '⚡', msg: 'Power through!' },
    { emoji: '🎯', msg: 'Stay focused!' },
  ];

  var streakParticleEmoji = ['⭐', '✨', '💫', '🌟', '🔥', '💥'];

  function showStreakBroken(lostStreak, callback) {
    session.paused = true;
    var overlay = document.getElementById('streak-overlay');
    var pick = streakMessages[Math.floor(Math.random() * streakMessages.length)];

    var emojiEl = document.getElementById('streak-lost-emoji');
    emojiEl.textContent = pick.emoji;
    emojiEl.className = '';
    void emojiEl.offsetWidth; // force reflow to retrigger animation
    emojiEl.className = 'animate__animated animate__bounceIn';

    var msgEl = document.getElementById('streak-lost-msg');
    msgEl.textContent = lostStreak >= 5
      ? pick.msg + ' (' + lostStreak + ' streak!)'
      : pick.msg;
    msgEl.className = '';
    void msgEl.offsetWidth;
    msgEl.className = 'animate__animated animate__fadeInUp';

    // Spawn falling particles
    var container = document.getElementById('streak-particles');
    container.innerHTML = '';
    for (var i = 0; i < 15; i++) {
      var p = document.createElement('span');
      p.className = 'streak-particle';
      p.textContent = streakParticleEmoji[Math.floor(Math.random() * streakParticleEmoji.length)];
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (2 + Math.random() * 2) + 's';
      p.style.animationDelay = (Math.random() * 1) + 's';
      container.appendChild(p);
    }

    overlay.style.display = '';

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      overlay.style.display = 'none';
      container.innerHTML = '';
      overlay.removeEventListener('click', dismiss);
      document.removeEventListener('keydown', dismissKey);
      session.paused = false;
      if (callback) callback();
    }

    function dismissKey(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        dismiss();
      }
    }

    // Auto-dismiss after 2.5s, or tap/key to dismiss early
    overlay.addEventListener('click', dismiss);
    document.addEventListener('keydown', dismissKey);
    setTimeout(dismiss, 2500);
  }

  // --- Timer ---
  function startTimer() {
    updateTimerDisplay();
    session.timerInterval = setInterval(function () {
      if (session.paused) return;
      session.timerSeconds--;
      updateTimerDisplay();
      if (session.timerSeconds <= 0) {
        endSession();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const m = Math.floor(session.timerSeconds / 60);
    const s = session.timerSeconds % 60;
    document.getElementById('timer-display').textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }

  // --- Session ---
  function startSession() {
    session.correct = 0;
    session.total = 0;
    session.streak = 0;
    session.previousFact = null;
    session.currentFact = null;
    session.paused = false;
    session.wrongFacts = [];
    session.waitingForConfirm = false;
    session.totalTime = 0;
    session.timerSeconds = data.settings.timerMinutes * 60;

    document.getElementById('streak-display').textContent = '0 🔥';
    document.getElementById('session-score').textContent = '0 correct';

    showScreen('practice');
    startTimer();
    nextProblem();
  }

  function endSession() {
    clearInterval(session.timerInterval);

    // Compute rate before zeroing timerSeconds
    var elapsedMinutes = data.settings.timerMinutes - (session.timerSeconds / 60);
    session.timerSeconds = 0;

    // Update history
    const today = new Date().toISOString().slice(0, 10);
    if (!data.history[today]) {
      data.history[today] = { correct: 0, total: 0 };
    }
    data.history[today].correct += session.correct;
    data.history[today].total += session.total;

    // Daily streak
    if (data.lastPracticeDate) {
      const last = new Date(data.lastPracticeDate + 'T00:00:00');
      const now = new Date(today + 'T00:00:00');
      const diffDays = Math.round((now - last) / 86400000);
      if (diffDays === 1) {
        data.dailyStreak++;
      } else if (diffDays > 1) {
        data.dailyStreak = 1;
      }
      // diffDays === 0: same day, don't change
    } else {
      data.dailyStreak = 1;
    }
    data.lastPracticeDate = today;

    // Personal best (correct per minute)
    var rate = elapsedMinutes > 0 ? Math.round((session.correct / elapsedMinutes) * 10) / 10 : 0;
    session.rate = rate;
    session.isNewBest = rate > data.personalBest;
    if (session.isNewBest) {
      data.personalBest = rate;
    }

    saveData();
    renderSummary();
    showScreen('summary');
  }

  // --- Summary ---
  function renderSummary() {
    document.getElementById('summary-correct').textContent = session.correct;
    document.getElementById('summary-total').textContent = session.total;
    const accuracy = session.total > 0 ? Math.round((session.correct / session.total) * 100) : 0;
    document.getElementById('summary-accuracy').textContent = accuracy + '%';
    const avgSpeed = session.total > 0 ? (session.totalTime / session.total / 1000).toFixed(1) : '0.0';
    document.getElementById('summary-speed').textContent = avgSpeed + 's';

    // Encouragement
    let msg;
    if (accuracy >= 95) msg = 'Outstanding! You\'re a multiplication master!';
    else if (accuracy >= 80) msg = 'Great job! Keep it up!';
    else if (accuracy >= 60) msg = 'Good effort! Practice makes perfect!';
    else msg = 'Keep going! Every practice makes you stronger!';

    if (session.isNewBest) {
      msg = 'NEW PERSONAL BEST! ' + msg;
    }
    document.getElementById('summary-message').textContent = msg;

    // Weak spots — top 5 by weight
    const list = document.getElementById('weak-list');
    list.innerHTML = '';
    const sorted = Object.entries(data.facts)
      .sort(function (a, b) { return b[1].weight - a[1].weight; })
      .slice(0, 5);

    const weakSection = document.getElementById('weak-spots');
    if (sorted.length > 0 && sorted[0][1].weight > 1) {
      weakSection.style.display = '';
      sorted.forEach(function (entry) {
        if (entry[1].weight <= 1) return;
        const parts = entry[0].split('x');
        const li = document.createElement('li');
        li.textContent = parts[0] + ' × ' + parts[1] + ' = ' + (parts[0] * parts[1]);
        list.appendChild(li);
      });
    } else {
      weakSection.style.display = 'none';
    }
  }

  // --- Progress Grid ---
  function masteryLevel(fact) {
    if (!fact) return 'none';
    if (fact.bestStreak >= 10) return 'gold';
    if (fact.bestStreak >= 6) return 'silver';
    if (fact.bestStreak >= 3) return 'bronze';
    return 'none';
  }

  function renderProgressGrid() {
    const table = document.getElementById('progress-grid');
    table.innerHTML = '';

    // Header row
    const headerRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.textContent = '×';
    headerRow.appendChild(corner);
    for (let c = 1; c <= 12; c++) {
      const th = document.createElement('th');
      th.textContent = c;
      headerRow.appendChild(th);
    }
    table.appendChild(headerRow);

    // Data rows
    for (let r = 1; r <= 12; r++) {
      const row = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = r;
      row.appendChild(th);
      for (let c = 1; c <= 12; c++) {
        const td = document.createElement('td');
        const key = canonicalKey(r, c);
        const fact = data.facts[key];
        td.className = 'mastery-' + masteryLevel(fact);
        td.textContent = r * c;
        td.title = key + ': streak ' + (fact ? fact.bestStreak : 0) + ', weight ' + (fact ? fact.weight : 5);
        row.appendChild(td);
      }
      table.appendChild(row);
    }
  }

  // --- Home ---
  function renderHome() {
    document.getElementById('daily-streak').textContent = data.dailyStreak + ' 🔥';
    document.getElementById('personal-best').textContent = data.personalBest + '/min ⭐';
    renderProgressGrid();

    // Highlight selected timer
    document.querySelectorAll('#timer-buttons button').forEach(function (btn) {
      btn.classList.toggle('selected', parseInt(btn.dataset.minutes, 10) === data.settings.timerMinutes);
    });
  }

  // --- Visibility API (pause when tab hidden) ---
  document.addEventListener('visibilitychange', function () {
    if (!session.timerInterval) return;
    // Don't unpause if streak interstitial is showing
    if (!document.hidden && document.getElementById('streak-overlay').style.display !== 'none') return;
    session.paused = document.hidden;
  });

  // --- Event Listeners ---
  document.getElementById('start-btn').addEventListener('click', startSession);

  document.getElementById('submit-btn').addEventListener('click', submitAnswer);

  function advanceAfterWrong() {
    session.waitingForConfirm = false;
    if (session.timerSeconds > 0 || session.paused) {
      nextProblem();
    }
  }

  document.getElementById('next-btn').addEventListener('click', advanceAfterWrong);

  document.getElementById('answer-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.stopPropagation();
      submitAnswer();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && session.waitingForConfirm) {
      advanceAfterWrong();
    }
  });

  document.getElementById('restart-btn').addEventListener('click', function () {
    startSession();
  });

  document.getElementById('home-btn').addEventListener('click', function () {
    renderHome();
    showScreen('home');
  });

  document.getElementById('timer-buttons').addEventListener('click', function (e) {
    if (!e.target.dataset.minutes) return;
    data.settings.timerMinutes = parseInt(e.target.dataset.minutes, 10);
    saveData();
    document.querySelectorAll('#timer-buttons button').forEach(function (btn) {
      btn.classList.toggle('selected', btn === e.target);
    });
  });

  // --- Init ---
  function init() {
    loadData();
    initFacts();
    renderHome();
    showScreen('home');
  }

  init();
})();
