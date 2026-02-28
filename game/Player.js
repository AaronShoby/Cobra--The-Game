// Player.js — Player state management

const { Deck } = require('./Deck');

class Player {
    constructor(id, name, socketId) {
        this.id = id;
        this.name = name;
        this.socketId = socketId;
        this.hand = [];           // Array of card objects
        this.knownCards = [];     // Indices of cards this player has seen
        this.connected = true;
        this.score = 0;
        this.totalScore = 0;     // Across multiple rounds
    }

    addCard(card) {
        this.hand.push(card);
        return this.hand.length - 1; // Return index of new card
    }

    removeCard(index) {
        if (index < 0 || index >= this.hand.length) return null;
        const card = this.hand.splice(index, 1)[0];
        // Adjust known card indices after removal
        this.knownCards = this.knownCards
            .filter(i => i !== index)
            .map(i => i > index ? i - 1 : i);
        return card;
    }

    swapCard(index, newCard) {
        if (index < 0 || index >= this.hand.length) return null;
        const oldCard = this.hand[index];
        this.hand[index] = newCard;
        // Remove from known if it was known (new card placed)
        this.knownCards = this.knownCards.filter(i => i !== index);
        return oldCard;
    }

    markKnown(index) {
        if (index >= 0 && index < this.hand.length && !this.knownCards.includes(index)) {
            this.knownCards.push(index);
        }
    }

    getScore() {
        return this.hand.reduce((sum, card) => sum + Deck.getCardValue(card), 0);
    }

    // Get hand info for the player themselves (shows known cards)
    getOwnHandView() {
        return this.hand.map((card, i) => ({
            index: i,
            known: this.knownCards.includes(i),
            card: this.knownCards.includes(i) ? card : null
        }));
    }

    // Get hand info for other players (all face down, just count)
    getPublicHandView() {
        return {
            id: this.id,
            name: this.name,
            cardCount: this.hand.length,
            connected: this.connected
        };
    }

    reset() {
        this.hand = [];
        this.knownCards = [];
        this.score = 0;
    }
}

module.exports = { Player };
