(function () {
  'use strict';

  var STORAGE_KEY = 'multiply-trainer';
  var FAST_THRESHOLD = 5000; // ms

  // --- Player Levels (space-themed) ---
  var LEVELS = [
    { min: 0,   title: 'Space Cadet',       badge: '\uD83E\uDDD1\u200D\uD83D\uDE80' },
    { min: 3,   title: 'Star Pilot',         badge: '\u2708\uFE0F' },
    { min: 8,   title: 'Asteroid Miner',     badge: '\u26CF\uFE0F' },
    { min: 18,  title: 'Nebula Navigator',   badge: '\uD83D\uDE80' },
    { min: 35,  title: 'Galaxy Explorer',    badge: '\uD83C\uDF00' },
    { min: 60,  title: 'Star Commander',     badge: '\uD83C\uDF96\uFE0F' },
    { min: 100, title: 'Universe Master',    badge: '\uD83C\uDF0C' },
  ];

  // --- State ---
  var data;
  var session = {
    correct: 0,
    total: 0,
    streak: 0,
    bestStreak: 0,
    streakCelebrated: false,
    timerSeconds: 0,
    timerInterval: null,
    currentFact: null,
    previousFact: null,
    problemStartTime: 0,
    paused: false,
    wrongFacts: [],
    totalTime: 0,
    waitingForRetype: false,
    requiredRetype: null,
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
      lastTitle: null,
    };
  }

  // --- LocalStorage ---
  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var base = defaults();
        data = {
          facts: parsed.facts || {},
          settings: { timerMinutes: (parsed.settings && parsed.settings.timerMinutes) || base.settings.timerMinutes },
          history: parsed.history || {},
          dailyStreak: parsed.dailyStreak || 0,
          lastPracticeDate: parsed.lastPracticeDate || null,
          personalBest: parsed.personalBest || 0,
          lastTitle: parsed.lastTitle || null,
        };
        // Migrate from 78-fact (canonical) to 144-fact format
        migrateToFullFacts();
      } else {
        data = defaults();
      }
    } catch (e) {
      data = defaults();
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // silently fail
    }
  }

  // --- Migration: 78 → 144 facts ---
  function migrateToFullFacts() {
    // Detect old format: if "2x1" doesn't exist but "1x2" does, we need to clone
    if (data.facts['1x2'] && !data.facts['2x1']) {
      for (var a = 1; a <= 12; a++) {
        for (var b = 1; b <= 12; b++) {
          if (a === b) continue;
          var key = a + 'x' + b;
          var canonical = (a < b) ? a + 'x' + b : b + 'x' + a;
          if (!data.facts[key] && data.facts[canonical]) {
            var src = data.facts[canonical];
            data.facts[key] = {
              weight: src.weight,
              correct: src.correct || 0,
              attempts: src.attempts || 0,
              streak: 0,
              bestStreak: src.bestStreak || 0,
            };
          }
        }
      }
      saveData();
    }
  }

  // --- Facts ---
  function initFacts() {
    for (var a = 1; a <= 12; a++) {
      for (var b = 1; b <= 12; b++) {
        var key = a + 'x' + b;
        if (!data.facts[key]) {
          data.facts[key] = { weight: 5, correct: 0, attempts: 0, streak: 0, bestStreak: 0 };
        }
      }
    }
    saveData();
  }

  // --- Screens ---
  function showScreen(name) {
    var sections = document.querySelectorAll('section');
    for (var i = 0; i < sections.length; i++) {
      sections[i].classList.remove('active');
    }
    document.getElementById(name).classList.add('active');
  }

  // --- Weighted Random Pick ---
  function pickNextFact() {
    var keys = Object.keys(data.facts);
    var totalWeight = 0;
    for (var i = 0; i < keys.length; i++) {
      totalWeight += data.facts[keys[i]].weight;
    }

    for (var attempt = 0; attempt < 4; attempt++) {
      var rand = Math.random() * totalWeight;
      for (var i = 0; i < keys.length; i++) {
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
    var key = pickNextFact();
    session.currentFact = key;
    session.previousFact = key;

    var parts = key.split('x').map(Number);
    var a = parts[0], b = parts[1];
    // No random swap — the key IS the display order now (commutative reinforcement)

    document.getElementById('problem-display').textContent = a + ' \u00D7 ' + b;
    document.querySelector('.answer-area').style.display = '';
    var input = document.getElementById('answer-input');
    input.value = '';
    input.placeholder = '?';
    input.focus();
    session.problemStartTime = Date.now();
    session.waitingForRetype = false;
    session.requiredRetype = null;

    // Clear feedback
    var fb = document.getElementById('feedback');
    fb.textContent = '';
    fb.className = 'feedback';
  }

  // --- Confetti Helper ---
  function fireConfetti(options) {
    if (typeof confetti === 'function') {
      confetti(options);
    }
  }

  // --- Player Level ---
  function getGoldPercent() {
    var keys = Object.keys(data.facts);
    if (keys.length === 0) return 0;
    var gold = 0;
    for (var i = 0; i < keys.length; i++) {
      if (data.facts[keys[i]].weight <= 2) gold++;
    }
    return Math.round((gold / keys.length) * 100);
  }

  // Weighted mastery score: bronze(w<=4)=1, silver(w<=3)=2, gold(w<=2)=3
  function getMasteryScore() {
    var keys = Object.keys(data.facts);
    if (keys.length === 0) return 0;
    var points = 0;
    for (var i = 0; i < keys.length; i++) {
      var w = data.facts[keys[i]].weight;
      if (w <= 2) points += 3;
      else if (w <= 3) points += 2;
      else if (w <= 4) points += 1;
    }
    return Math.round((points / (keys.length * 3)) * 100);
  }

  function getPlayerLevel() {
    var pct = getMasteryScore();
    var levelIndex = 0;
    for (var i = LEVELS.length - 1; i >= 0; i--) {
      if (pct >= LEVELS[i].min) {
        levelIndex = i;
        break;
      }
    }

    // Decay: lose 1 level per 2 days inactive, never below Star Pilot (index 1)
    if (data.lastPracticeDate) {
      var today = new Date().toISOString().slice(0, 10);
      var daysInactive = Math.floor((new Date(today + 'T00:00:00') - new Date(data.lastPracticeDate + 'T00:00:00')) / 86400000);
      if (daysInactive >= 2) {
        levelIndex = Math.max(1, levelIndex - Math.floor(daysInactive / 2));
      }
    }

    return LEVELS[levelIndex];
  }

  // --- Celebration Overlay (reusable for mastery + level-up) ---
  var celebrationQueue = [];
  var celebrationShowing = false;

  function queueCelebration(emoji, msg, confettiOpts) {
    celebrationQueue.push({ emoji: emoji, msg: msg, confettiOpts: confettiOpts });
    if (!celebrationShowing) showNextCelebration();
  }

  function showNextCelebration() {
    if (celebrationQueue.length === 0) {
      celebrationShowing = false;
      return;
    }
    celebrationShowing = true;
    session.paused = true;
    var item = celebrationQueue.shift();
    var overlay = document.getElementById('celebration-overlay');

    var emojiEl = document.getElementById('celebration-emoji');
    emojiEl.textContent = item.emoji;
    emojiEl.className = '';
    void emojiEl.offsetWidth;
    emojiEl.className = 'animate__animated animate__bounceIn';

    var msgEl = document.getElementById('celebration-msg');
    msgEl.textContent = item.msg;
    msgEl.className = '';
    void msgEl.offsetWidth;
    msgEl.className = 'animate__animated animate__fadeInUp';

    overlay.style.display = '';

    if (item.confettiOpts) {
      fireConfetti(item.confettiOpts);
    }

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      overlay.style.display = 'none';
      overlay.removeEventListener('click', dismiss);
      document.removeEventListener('keydown', dismissKey);
      session.paused = false;
      // Show next in queue or resume
      if (celebrationQueue.length > 0) {
        showNextCelebration();
      } else {
        celebrationShowing = false;
        // Resume play
        if (session.timerSeconds > 0 || session.paused) {
          nextProblem();
        }
      }
    }
    function dismissKey(e) {
      if (e.key === 'Enter' || e.key === ' ') dismiss();
    }
    overlay.addEventListener('click', dismiss);
    document.addEventListener('keydown', dismissKey);
    setTimeout(dismiss, 2500);
  }

  // --- Submit ---
  function submitAnswer() {
    if (session.paused) return;
    var input = document.getElementById('answer-input');

    // Handle retype mode
    if (session.waitingForRetype) {
      var retypeVal = parseInt(input.value, 10);
      if (isNaN(retypeVal)) return;
      if (retypeVal === session.requiredRetype) {
        // Correct retype — advance (no stats counted)
        session.waitingForRetype = false;
        session.requiredRetype = null;
        if (session.timerSeconds > 0 || session.paused) {
          nextProblem();
        }
      } else {
        // Wrong retype — shake and clear
        input.value = '';
        var fb = document.getElementById('feedback');
        fb.className = 'feedback';
        void fb.offsetWidth;
        fb.className = 'feedback wrong';
      }
      return;
    }

    var value = parseInt(input.value, 10);
    if (isNaN(value)) return;

    var key = session.currentFact;
    var parts = key.split('x').map(Number);
    var correctAnswer = parts[0] * parts[1];
    var elapsed = Date.now() - session.problemStartTime;
    session.totalTime += elapsed;
    var fact = data.facts[key];
    var fb = document.getElementById('feedback');

    fact.attempts++;
    session.total++;

    if (value === correctAnswer) {
      input.value = '';
      var oldWeight = fact.weight;
      fact.correct++;
      fact.streak++;
      if (fact.streak > fact.bestStreak) fact.bestStreak = fact.streak;

      if (elapsed <= FAST_THRESHOLD) {
        fact.weight = Math.max(1, fact.weight - 1);
      }

      session.correct++;
      session.streak++;
      var isNewBestStreak = session.streak > session.bestStreak && session.bestStreak >= 3 && !session.streakCelebrated;
      if (session.streak > session.bestStreak) session.bestStreak = session.streak;
      if (isNewBestStreak) session.streakCelebrated = true;

      fb.textContent = getCorrectMessage();
      fb.className = 'feedback correct';

      document.getElementById('streak-display').textContent = session.streak + ' \uD83D\uDD25';
      document.getElementById('best-streak-display').textContent = 'Best: ' + session.bestStreak;
      document.getElementById('session-score').textContent = session.correct + ' correct';

      saveData();

      // Check for gold mastery milestone (weight dropped to 2 or below)
      var justMastered = fact.weight <= 2 && oldWeight > 2;

      // Check for level-up
      var currentLevel = getPlayerLevel();
      var leveledUp = data.lastTitle && currentLevel.title !== data.lastTitle && LEVELS.indexOf(currentLevel) > LEVELS.indexOf(LEVELS.find(function (l) { return l.title === data.lastTitle; }) || LEVELS[0]);
      if (currentLevel.title !== data.lastTitle) {
        data.lastTitle = currentLevel.title;
        saveData();
      }

      // Queue celebrations (mastery first, then level-up, then streak)
      if (justMastered) {
        queueCelebration(
          '\uD83C\uDFC6',
          parts[0] + ' \u00D7 ' + parts[1] + ' Mastered!',
          { particleCount: 80, spread: 70, colors: ['#34D399', '#FFD700'] }
        );
      }

      if (leveledUp) {
        queueCelebration(
          currentLevel.badge,
          currentLevel.title + '!',
          { particleCount: 120, spread: 100, startVelocity: 35 }
        );
      }

      if (isNewBestStreak) {
        var streakPick = streakMessages[Math.floor(Math.random() * streakMessages.length)];
        queueCelebration(
          streakPick.emoji,
          session.bestStreak + ' in a row! ' + streakPick.msg,
          session.bestStreak >= 10 ? { particleCount: 60, spread: 55 } : null
        );
      } else if (!justMastered && !leveledUp && !isNewBestStreak) {
        setTimeout(function () {
          if (!celebrationShowing && (session.timerSeconds > 0 || session.paused)) {
            nextProblem();
          }
        }, 400);
      }
      // If mastery/level celebrations queued, showNextCelebration handles advancing
    } else {
      fact.weight += 3;
      fact.streak = 0;
      session.streak = 0;
      session.streakCelebrated = false;

      if (!session.wrongFacts.includes(key)) {
        session.wrongFacts.push(key);
      }

      fb.textContent = correctAnswer + '  \u2014 ' + parts[0] + ' \u00D7 ' + parts[1] + ' = ' + correctAnswer;
      fb.className = 'feedback wrong';

      document.getElementById('streak-display').textContent = session.streak + ' \uD83D\uDD25';
      document.getElementById('best-streak-display').textContent = 'Best: ' + session.bestStreak;
      document.getElementById('session-score').textContent = session.correct + ' correct';

      saveData();

      // Retype mode: child must type the correct answer
      session.waitingForRetype = true;
      session.requiredRetype = correctAnswer;
      input.value = '';
      input.placeholder = String(correctAnswer);
      input.focus();
    }
  }

  function getCorrectMessage() {
    var s = session.streak;
    if (s === 20) return 'UNSTOPPABLE! 20 in a row!';
    if (s === 15) return 'INCREDIBLE! 15 streak!';
    if (s === 10) return 'AMAZING! 10 in a row!';
    if (s === 5) return 'GREAT! 5 in a row!';
    var msgs = ['Correct!', 'Nice!', 'Yes!', 'Got it!', 'Right!'];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }

  // --- New Best Streak Celebration ---
  var streakMessages = [
    { emoji: '\uD83C\uDF89', msg: 'New record!' },
    { emoji: '\uD83C\uDFC6', msg: 'New best streak!' },
    { emoji: '\uD83D\uDE80', msg: 'You\'re on fire!' },
    { emoji: '\u2B50', msg: 'Superstar!' },
    { emoji: '\uD83C\uDF1F', msg: 'Incredible!' },
    { emoji: '\uD83D\uDCAB', msg: 'Unstoppable!' },
  ];

  var streakParticleEmoji = ['\u2B50', '\u2728', '\uD83D\uDCAB', '\uD83C\uDF1F', '\uD83C\uDF89', '\uD83C\uDFC6'];

  function showStreakCelebration(newBest, callback) {
    session.paused = true;
    var overlay = document.getElementById('streak-overlay');
    var pick = streakMessages[Math.floor(Math.random() * streakMessages.length)];

    var emojiEl = document.getElementById('streak-lost-emoji');
    emojiEl.textContent = pick.emoji;
    emojiEl.className = '';
    void emojiEl.offsetWidth;
    emojiEl.className = 'animate__animated animate__bounceIn';

    var msgEl = document.getElementById('streak-lost-msg');
    msgEl.textContent = newBest + ' in a row! ' + pick.msg;
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
    var m = Math.floor(session.timerSeconds / 60);
    var s = session.timerSeconds % 60;
    document.getElementById('timer-display').textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }

  // --- Session ---
  function startSession() {
    session.correct = 0;
    session.total = 0;
    session.streak = 0;
    session.bestStreak = 0;
    session.previousFact = null;
    session.currentFact = null;
    session.paused = false;
    session.wrongFacts = [];
    session.waitingForRetype = false;
    session.requiredRetype = null;
    session.streakCelebrated = false;
    session.totalTime = 0;
    session.timerSeconds = data.settings.timerMinutes * 60;
    celebrationQueue = [];
    celebrationShowing = false;

    document.getElementById('streak-display').textContent = '0 \uD83D\uDD25';
    document.getElementById('best-streak-display').textContent = 'Best: 0';
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
    var today = new Date().toISOString().slice(0, 10);
    if (!data.history[today]) {
      data.history[today] = { correct: 0, total: 0 };
    }
    data.history[today].correct += session.correct;
    data.history[today].total += session.total;

    // Daily streak
    if (data.lastPracticeDate) {
      var last = new Date(data.lastPracticeDate + 'T00:00:00');
      var now = new Date(today + 'T00:00:00');
      var diffDays = Math.round((now - last) / 86400000);
      if (diffDays === 1) {
        data.dailyStreak++;
      } else if (diffDays > 1) {
        data.dailyStreak = 1;
      }
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

    // Save last round stats
    var avgSpeed = session.total > 0 ? (session.totalTime / session.total / 1000).toFixed(1) : '0.0';
    data.lastRound = {
      correct: session.correct,
      total: session.total,
      accuracy: session.total > 0 ? Math.round((session.correct / session.total) * 100) : 0,
      speed: avgSpeed,
      rate: rate,
      bestStreak: session.bestStreak,
    };

    saveData();
    renderSummary();
    showScreen('summary');
  }

  // --- Summary ---
  function renderSummary() {
    document.getElementById('summary-correct').textContent = session.correct;
    document.getElementById('summary-total').textContent = session.total;
    var accuracy = session.total > 0 ? Math.round((session.correct / session.total) * 100) : 0;
    document.getElementById('summary-accuracy').textContent = accuracy + '%';
    var avgSpeed = session.total > 0 ? (session.totalTime / session.total / 1000).toFixed(1) : '0.0';
    document.getElementById('summary-speed').textContent = avgSpeed + 's';

    var msg;
    if (accuracy >= 95) msg = 'Outstanding! You\'re a multiplication master!';
    else if (accuracy >= 80) msg = 'Great job! Keep it up!';
    else if (accuracy >= 60) msg = 'Good effort! Practice makes perfect!';
    else msg = 'Keep going! Every practice makes you stronger!';

    if (session.isNewBest) {
      msg = 'NEW PERSONAL BEST! ' + msg;
    }
    document.getElementById('summary-message').textContent = msg;

    // Weak spots — facts missed this round
    var list = document.getElementById('weak-list');
    list.innerHTML = '';
    var weakSection = document.getElementById('weak-spots');

    if (session.wrongFacts.length > 0) {
      weakSection.style.display = '';
      for (var i = 0; i < session.wrongFacts.length; i++) {
        var parts = session.wrongFacts[i].split('x');
        var li = document.createElement('li');
        li.textContent = parts[0] + ' \u00D7 ' + parts[1] + ' = ' + (parts[0] * parts[1]);
        list.appendChild(li);
      }
    } else {
      weakSection.style.display = 'none';
      fireConfetti({ particleCount: 100, spread: 80, colors: ['#34D399', '#FFD700', '#60A5FA'] });
    }
  }

  // --- Progress Grid ---
  function masteryLevel(fact) {
    if (!fact) return 'none';
    if (fact.weight <= 2) return 'gold';
    if (fact.weight <= 3) return 'silver';
    if (fact.weight <= 4) return 'bronze';
    return 'none';
  }

  function renderProgressGrid() {
    var table = document.getElementById('progress-grid');
    table.innerHTML = '';

    // Header row
    var headerRow = document.createElement('tr');
    var corner = document.createElement('th');
    corner.textContent = '\u00D7';
    headerRow.appendChild(corner);
    for (var c = 1; c <= 12; c++) {
      var th = document.createElement('th');
      th.textContent = c;
      headerRow.appendChild(th);
    }
    table.appendChild(headerRow);

    // Data rows
    for (var r = 1; r <= 12; r++) {
      var row = document.createElement('tr');
      var rth = document.createElement('th');
      rth.textContent = r;
      row.appendChild(rth);
      for (var c = 1; c <= 12; c++) {
        var td = document.createElement('td');
        var key = r + 'x' + c;
        var fact = data.facts[key];
        td.className = 'mastery-' + masteryLevel(fact);
        td.textContent = r * c;
        td.title = key + ': streak ' + (fact ? fact.bestStreak : 0) + ', weight ' + (fact ? fact.weight : 5);
        row.appendChild(td);
      }
      table.appendChild(row);
    }
  }

  // --- History View ---
  function renderHistory() {
    var container = document.getElementById('history-list');
    container.innerHTML = '';

    var dates = Object.keys(data.history).sort().reverse().slice(0, 30);

    if (dates.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);font-weight:700;">No sessions yet. Start practicing!</p>';
      return;
    }

    for (var i = 0; i < dates.length; i++) {
      var date = dates[i];
      var entry = data.history[date];
      var accuracy = entry.total > 0 ? Math.round((entry.correct / entry.total) * 100) : 0;

      var div = document.createElement('div');
      div.className = 'history-day';

      var dateSpan = document.createElement('span');
      dateSpan.className = 'history-date';
      dateSpan.textContent = formatDate(date);

      var statsSpan = document.createElement('span');
      statsSpan.className = 'history-stats';
      statsSpan.innerHTML = entry.correct + '/' + entry.total + ' <span class="history-accuracy">' + accuracy + '%</span>';

      div.appendChild(dateSpan);
      div.appendChild(statsSpan);
      container.appendChild(div);
    }
  }

  function formatDate(dateStr) {
    var parts = dateStr.split('-');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
  }

  // --- Weakest Facts View ---
  function renderWeakest() {
    var container = document.getElementById('weakest-list');
    container.innerHTML = '';

    var sorted = Object.entries(data.facts)
      .sort(function (a, b) { return b[1].weight - a[1].weight; })
      .slice(0, 20);

    if (sorted.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);font-weight:700;">No facts yet.</p>';
      return;
    }

    for (var i = 0; i < sorted.length; i++) {
      var entry = sorted[i];
      var key = entry[0];
      var fact = entry[1];
      var parts = key.split('x');
      var level = masteryLevel(fact);

      var div = document.createElement('div');
      div.className = 'weakest-row';
      if (level !== 'none') div.className += ' mastery-border-' + level;

      var factSpan = document.createElement('span');
      factSpan.className = 'weakest-fact';
      factSpan.textContent = parts[0] + ' \u00D7 ' + parts[1] + ' = ' + (parts[0] * parts[1]);

      var infoSpan = document.createElement('span');
      infoSpan.className = 'weakest-info';
      infoSpan.textContent = 'W:' + fact.weight + ' Best:' + fact.bestStreak;

      div.appendChild(factSpan);
      div.appendChild(infoSpan);
      container.appendChild(div);
    }
  }

  // --- Home ---
  function renderHome() {
    document.getElementById('daily-streak').textContent = data.dailyStreak + ' \uD83D\uDD25';
    document.getElementById('personal-best').textContent = data.personalBest + '/min \u2B50';
    renderProgressGrid();

    // Player level
    var level = getPlayerLevel();
    var masteryPct = getMasteryScore();
    var levelIndex = LEVELS.indexOf(level);
    var nextLevel = LEVELS[levelIndex + 1] || null;

    document.getElementById('player-level').textContent = 'Current Level: ' + level.badge + ' ' + level.title;

    // Progress bar: how far through current level toward next
    var barPct = 0;
    if (nextLevel) {
      var rangeStart = level.min;
      var rangeEnd = nextLevel.min;
      barPct = Math.min(100, Math.round(((masteryPct - rangeStart) / (rangeEnd - rangeStart)) * 100));
    } else {
      barPct = 100; // Universe Master
    }
    document.getElementById('level-bar').style.width = barPct + '%';

    // Next level (faded)
    var nextEl = document.getElementById('next-level');
    if (nextLevel) {
      nextEl.textContent = 'Next Level: ' + nextLevel.badge + ' ' + nextLevel.title;
      nextEl.style.display = '';
    } else {
      nextEl.style.display = 'none';
    }

    if (!data.lastTitle) {
      data.lastTitle = level.title;
      saveData();
    }

    // Highlight selected timer
    var timerBtns = document.querySelectorAll('#timer-buttons button');
    for (var i = 0; i < timerBtns.length; i++) {
      timerBtns[i].classList.toggle('selected', parseInt(timerBtns[i].dataset.minutes, 10) === data.settings.timerMinutes);
    }

    // Last round button
    var btn = document.getElementById('last-round-btn');
    var panel = document.getElementById('last-round-panel');
    if (data.lastRound) {
      btn.style.display = '';
      document.getElementById('lr-correct').textContent = data.lastRound.correct;
      document.getElementById('lr-total').textContent = data.lastRound.total;
      document.getElementById('lr-accuracy').textContent = data.lastRound.accuracy + '%';
      document.getElementById('lr-speed').textContent = data.lastRound.speed + 's';
      document.getElementById('lr-rate').textContent = data.lastRound.rate + '/min';
      document.getElementById('lr-best-streak').textContent = data.lastRound.bestStreak;
    } else {
      btn.style.display = 'none';
      panel.style.display = 'none';
    }
  }

  // --- Visibility API (pause when tab hidden) ---
  document.addEventListener('visibilitychange', function () {
    if (!session.timerInterval) return;
    if (!document.hidden && document.getElementById('streak-overlay').style.display !== 'none') return;
    if (!document.hidden && document.getElementById('celebration-overlay').style.display !== 'none') return;
    session.paused = document.hidden;
  });

  // --- Transfer: Export / Import ---
  // v1 canonical fact order (78 facts, for backward compat)
  var FACT_KEYS_V1 = [];
  for (var a = 1; a <= 12; a++) {
    for (var b = a; b <= 12; b++) {
      FACT_KEYS_V1.push(a + 'x' + b);
    }
  }

  // v2 full fact order (144 facts)
  var FACT_KEYS = [];
  for (var a = 1; a <= 12; a++) {
    for (var b = 1; b <= 12; b++) {
      FACT_KEYS.push(a + 'x' + b);
    }
  }

  function crc8(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (var j = 0; j < 8; j++) {
        crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
      }
    }
    return crc;
  }

  function exportCode() {
    // v2: [version 1B][dailyStreak 1B][personalBest×10 2B][144 facts × (weight 5b + bestStreak 4b)]
    var bytes = [];
    bytes.push(2); // version 2
    bytes.push(Math.min(data.dailyStreak, 255));
    var pb = Math.min(Math.round(data.personalBest * 10), 65535);
    bytes.push((pb >> 8) & 0xFF);
    bytes.push(pb & 0xFF);

    // Pack 144 facts: 9 bits each
    var bits = [];
    for (var i = 0; i < FACT_KEYS.length; i++) {
      var fact = data.facts[FACT_KEYS[i]];
      var w = fact ? Math.min(fact.weight, 31) : 5;
      var bs = fact ? Math.min(fact.bestStreak, 15) : 0;
      for (var b = 4; b >= 0; b--) bits.push((w >> b) & 1);
      for (var b = 3; b >= 0; b--) bits.push((bs >> b) & 1);
    }

    // Pack bits into bytes
    while (bits.length % 8 !== 0) bits.push(0);
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
      bytes.push(byte);
    }

    // Append CRC
    bytes.push(crc8(bytes));

    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return hex.toUpperCase();
  }

  function importCode(hex) {
    hex = hex.replace(/\s/g, '').toUpperCase();
    if (!/^[0-9A-F]+$/.test(hex)) return 'Invalid code: not a hex string';
    if (hex.length % 2 !== 0) return 'Invalid code: odd length';

    var bytes = [];
    for (var i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }

    // Verify CRC
    var storedCrc = bytes.pop();
    if (crc8(bytes) !== storedCrc) return 'Invalid code: checksum mismatch';

    var version = bytes[0];
    if (version !== 1 && version !== 2) return 'Unsupported code version';

    var dailyStreak = bytes[1];
    var personalBest = ((bytes[2] << 8) | bytes[3]) / 10;

    // Unpack bits
    var bits = [];
    for (var i = 4; i < bytes.length; i++) {
      for (var b = 7; b >= 0; b--) bits.push((bytes[i] >> b) & 1);
    }

    var factKeys = (version === 1) ? FACT_KEYS_V1 : FACT_KEYS;

    var idx = 0;
    for (var i = 0; i < factKeys.length; i++) {
      var w = 0;
      for (var b = 0; b < 5; b++) w = (w << 1) | (bits[idx++] || 0);
      var bs = 0;
      for (var b = 0; b < 4; b++) bs = (bs << 1) | (bits[idx++] || 0);

      var key = factKeys[i];
      if (!data.facts[key]) {
        data.facts[key] = { weight: w, correct: 0, attempts: 0, streak: 0, bestStreak: bs };
      } else {
        data.facts[key].weight = w;
        data.facts[key].bestStreak = bs;
        data.facts[key].streak = 0;
      }
    }

    data.dailyStreak = dailyStreak;
    data.personalBest = personalBest;

    // If v1, run migration to fill in reverse facts
    if (version === 1) {
      migrateToFullFacts();
      initFacts(); // ensure all 144 exist
    }

    saveData();
    renderHome();
    return null; // success
  }

  // --- Event Listeners ---
  document.getElementById('start-btn').addEventListener('click', startSession);

  document.getElementById('last-round-btn').addEventListener('click', function () {
    var panel = document.getElementById('last-round-panel');
    var showing = panel.style.display !== 'none';
    panel.style.display = showing ? 'none' : '';
    this.textContent = showing ? 'Last Round Stats' : 'Hide Stats';
  });

  document.getElementById('export-btn').addEventListener('click', function () {
    var area = document.getElementById('export-area');
    var code = exportCode();
    document.getElementById('export-code').value = code;
    area.style.display = '';
    document.getElementById('copy-msg').textContent = '';
  });

  document.getElementById('copy-btn').addEventListener('click', function () {
    var code = document.getElementById('export-code').value;
    navigator.clipboard.writeText(code).then(function () {
      document.getElementById('copy-msg').textContent = 'Copied!';
      document.getElementById('copy-msg').style.color = 'var(--correct)';
    }).catch(function () {
      document.getElementById('export-code').select();
      document.getElementById('copy-msg').textContent = 'Select all & copy manually';
      document.getElementById('copy-msg').style.color = 'var(--primary)';
    });
  });

  document.getElementById('import-btn').addEventListener('click', function () {
    var code = document.getElementById('import-code').value.trim();
    var msg = document.getElementById('import-msg');
    if (!code) {
      msg.textContent = 'Paste a transfer code first';
      msg.style.color = 'var(--wrong)';
      return;
    }
    var err = importCode(code);
    if (err) {
      msg.textContent = err;
      msg.style.color = 'var(--wrong)';
    } else {
      msg.textContent = 'Progress imported!';
      msg.style.color = 'var(--correct)';
      document.getElementById('import-code').value = '';
    }
  });

  // End session early
  document.getElementById('end-btn').addEventListener('click', function () {
    clearInterval(session.timerInterval);
    session.timerSeconds = 0;
    renderHome();
    showScreen('home');
  });

  // Reset progress
  document.getElementById('reset-btn').addEventListener('click', function () {
    if (confirm('Reset ALL progress? This cannot be undone.')) {
      data = defaults();
      initFacts();
      saveData();
      renderHome();
    }
  });

  // History navigation
  document.getElementById('history-btn').addEventListener('click', function () {
    renderHistory();
    showScreen('history');
  });
  document.getElementById('history-back-btn').addEventListener('click', function () {
    renderHome();
    showScreen('home');
  });

  // Weakest facts navigation
  document.getElementById('weakest-btn').addEventListener('click', function () {
    renderWeakest();
    showScreen('weakest');
  });
  document.getElementById('weakest-back-btn').addEventListener('click', function () {
    renderHome();
    showScreen('home');
  });

  document.getElementById('submit-btn').addEventListener('click', submitAnswer);

  document.getElementById('answer-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.stopPropagation();
      submitAnswer();
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
    var btns = document.querySelectorAll('#timer-buttons button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('selected', btns[i] === e.target);
    }
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
