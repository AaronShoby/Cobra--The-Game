// cards.js — Card rendering utilities

const SUIT_SYMBOLS = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
};

const SUIT_COLORS = {
    hearts: 'red',
    diamonds: 'red',
    clubs: 'black',
    spades: 'black'
};

function getSuitSymbol(suit) {
    return SUIT_SYMBOLS[suit] || '?';
}

function getSuitColor(suit) {
    return SUIT_COLORS[suit] || 'black';
}

function getCardValue(card) {
    if (!card) return 0;
    const { rank, suit } = card;
    if (rank === 'A') return 1;
    if (!isNaN(parseInt(rank))) return parseInt(rank);
    if (rank === 'K' && (suit === 'hearts' || suit === 'diamonds')) return -1;
    if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
    return 0;
}

function getCardPowerName(card) {
    if (!card) return null;
    const { rank, suit } = card;
    if (rank === '7' || rank === '8') return 'Peek Own';
    if (rank === '9' || rank === '10') return 'Peek Other';
    if (rank === 'Q') return 'Queen Swap';
    if (rank === 'J' && (suit === 'spades' || suit === 'clubs')) return 'Black Jack';
    return null;
}

// Create a face-up card element
function createCardElement(card, options = {}) {
    const { small = false, selectable = false, selected = false, onClick = null, showPower = false } = options;

    const el = document.createElement('div');
    el.className = `card ${small ? 'card-small' : ''}`;
    if (selectable) el.classList.add('selectable');
    if (selected) el.classList.add('selected');

    const color = getSuitColor(card.suit);
    const symbol = getSuitSymbol(card.suit);

    el.innerHTML = `
    <div class="card-face ${color}">
      <div class="card-corner card-corner-tl">
        <span>${card.rank}</span>
        <span>${symbol}</span>
      </div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
        <span class="card-rank">${card.rank}</span>
        <span class="card-suit">${symbol}</span>
      </div>
      <div class="card-corner card-corner-br">
        <span>${card.rank}</span>
        <span>${symbol}</span>
      </div>
    </div>
  `;

    if (showPower) {
        const powerName = getCardPowerName(card);
        if (powerName) {
            const badge = document.createElement('div');
            badge.className = 'card-power-badge';
            badge.textContent = powerName;
            el.appendChild(badge);
        }
    }

    if (onClick) {
        el.addEventListener('click', onClick);
        el.style.cursor = 'pointer';
    }

    return el;
}

// Create a face-down card element
function createCardBack(options = {}) {
    const { small = false, selectable = false, onClick = null } = options;

    const el = document.createElement('div');
    el.className = `card ${small ? 'card-small' : ''}`;
    if (selectable) el.classList.add('selectable');

    el.innerHTML = `
    <div class="card-back">
      <div class="card-back-design">🐍</div>
    </div>
  `;

    if (onClick) {
        el.addEventListener('click', onClick);
        el.style.cursor = 'pointer';
    }

    return el;
}

// Create a mini card for scoreboard
function createMiniCard(card) {
    const el = document.createElement('div');
    const color = getSuitColor(card.suit);
    const symbol = getSuitSymbol(card.suit);
    el.className = 'card score-mini-card';
    el.innerHTML = `
    <div class="card-face ${color}" style="padding:2px; font-size:0.5rem; gap:0;">
      <span style="font-size:0.5rem; line-height:1;">${card.rank}</span>
      <span style="font-size:0.6rem; line-height:1;">${symbol}</span>
    </div>
  `;
    return el;
}
