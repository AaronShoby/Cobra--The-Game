// Deck.js — Standard 52-card deck management

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

class Deck {
    constructor() {
        this.cards = [];
        this.discardPile = [];
        this.init();
    }

    init() {
        this.cards = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                this.cards.push({ suit, rank, id: `${rank}_${suit}` });
            }
        }
    }

    shuffle() {
        // Fisher-Yates shuffle
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    draw() {
        if (this.cards.length === 0) {
            // Reshuffle discard pile into deck (keep top card)
            if (this.discardPile.length <= 1) return null;
            const topDiscard = this.discardPile.pop();
            this.cards = [...this.discardPile];
            this.discardPile = [topDiscard];
            this.shuffle();
        }
        return this.cards.pop();
    }

    discard(card) {
        this.discardPile.push(card);
    }

    getTopDiscard() {
        return this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null;
    }

    remaining() {
        return this.cards.length;
    }

    // Get numeric value of a card
    static getCardValue(card) {
        if (!card) return 0;
        const { rank, suit } = card;

        // Ace = 1
        if (rank === 'A') return 1;

        // Number cards (2-10) = face value
        if (!isNaN(parseInt(rank))) return parseInt(rank);

        // Red King (hearts/diamonds) = -1
        if (rank === 'K' && (suit === 'hearts' || suit === 'diamonds')) return -1;

        // Black King, Queen, Jack = 10
        if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;

        return 0;
    }

    // Check if a card has a special power
    static hasPower(card) {
        if (!card) return false;
        const { rank, suit } = card;
        if (rank === '7' || rank === '8') return 'peekOwn';
        if (rank === '9' || rank === '10') return 'peekOther';
        if (rank === 'Q') return 'queenSwap';
        if (rank === 'J' && (suit === 'spades' || suit === 'clubs')) return 'blackJack';
        return false;
    }

    // Check if card is red suit
    static isRedSuit(card) {
        return card && (card.suit === 'hearts' || card.suit === 'diamonds');
    }
}

module.exports = { Deck, SUITS, RANKS };
