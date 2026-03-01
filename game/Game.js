// Game.js — Core game state and logic

const { Deck } = require('./Deck');
const { Player } = require('./Player');

const PHASES = {
    WAITING: 'waiting',
    INITIAL_PEEK: 'initial_peek',
    PLAYING: 'playing',
    COBRA_CALLED: 'cobra_called',
    ROUND_OVER: 'round_over'
};

class Game {
    constructor(roomCode) {
        this.roomCode = roomCode;
        this.players = [];
        this.deck = new Deck();
        this.phase = PHASES.WAITING;
        this.currentPlayerIndex = 0;
        this.drawnCard = null;           // Card currently drawn by active player
        this.cobraCaller = null;         // Player ID who called cobra
        this.cobraCallerIndex = null;    // Index of cobra caller for turn tracking
        this.turnsSinceCobra = 0;
        this.hostId = null;
        this.lastDiscard = null;         // Last discarded card (for snap mechanic)
        this.snapWindow = false;         // Whether snap is currently possible
        this.snapTimeout = null;
        this.pendingPower = null;        // Power that needs resolution
        this.roundNumber = 0;
    }

    // --- Player Management ---

    addPlayer(name, socketId) {
        const id = `player_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const player = new Player(id, name, socketId);
        this.players.push(player);
        if (!this.hostId) this.hostId = id;
        return player;
    }

    removePlayer(socketId) {
        const player = this.players.find(p => p.socketId === socketId);
        if (player) {
            player.connected = false;
            // If it was their turn, skip to next
            if (this.phase === PHASES.PLAYING && this.getCurrentPlayer()?.socketId === socketId) {
                this.drawnCard = null;
                this.pendingPower = null;
                this.nextTurn();
            }
        }
        return player;
    }

    reconnectPlayer(socketId, playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.socketId = socketId;
            player.connected = true;
        }
        return player;
    }

    getPlayerBySocket(socketId) {
        return this.players.find(p => p.socketId === socketId);
    }

    getPlayerById(playerId) {
        return this.players.find(p => p.id === playerId);
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex] || null;
    }

    getConnectedPlayers() {
        return this.players.filter(p => p.connected);
    }

    // --- Game Lifecycle ---

    startGame() {
        if (this.players.length < 2) return { error: 'Need at least 2 players' };

        this.roundNumber++;
        this.deck = new Deck();
        this.deck.shuffle();
        this.phase = PHASES.INITIAL_PEEK;
        this.cobraCaller = null;
        this.cobraCallerIndex = null;
        this.turnsSinceCobra = 0;
        this.drawnCard = null;
        this.lastDiscard = null;
        this.snapWindow = false;
        this.pendingPower = null;

        // Reset players and deal 4 cards each
        for (const player of this.players) {
            player.reset();
            for (let i = 0; i < 4; i++) {
                const card = this.deck.draw();
                if (card) player.addCard(card);
            }
        }

        // Put one card on discard pile to start
        const firstDiscard = this.deck.draw();
        if (firstDiscard) this.deck.discard(firstDiscard);

        this.currentPlayerIndex = 0;

        return { success: true };
    }

    // Player peeks at 2 of their cards during initial phase
    initialPeek(playerId, indices) {
        if (this.phase !== PHASES.INITIAL_PEEK) return { error: 'Not in peek phase' };

        const player = this.getPlayerById(playerId);
        if (!player) return { error: 'Player not found' };

        if (!Array.isArray(indices) || indices.length !== 2) {
            return { error: 'Must peek at exactly 2 cards' };
        }

        if (indices.some(i => i < 0 || i >= player.hand.length)) {
            return { error: 'Invalid card index' };
        }

        indices.forEach(i => player.markKnown(i));

        // Return the peeked cards
        const peekedCards = indices.map(i => ({
            index: i,
            card: player.hand[i]
        }));

        return { success: true, cards: peekedCards };
    }

    // All players have peeked, begin play
    startPlaying() {
        this.phase = PHASES.PLAYING;
        this.currentPlayerIndex = 0;
        return { success: true };
    }

    // --- Turn Actions ---

    drawCard(playerId) {
        const player = this.getCurrentPlayer();
        if (!player || player.id !== playerId) return { error: 'Not your turn' };
        if (this.phase !== PHASES.PLAYING && this.phase !== PHASES.COBRA_CALLED) return { error: 'Game not in play' };
        if (this.drawnCard) return { error: 'Already drew a card' };

        const card = this.deck.draw();
        if (!card) return { error: 'Deck is empty' };

        this.drawnCard = card;
        this.snapWindow = false;

        const power = Deck.hasPower(card);

        return {
            success: true,
            card: card,
            power: power
        };
    }

    // Swap drawn card with a card in hand
    swapWithHand(playerId, handIndex) {
        const player = this.getCurrentPlayer();
        if (!player || player.id !== playerId) return { error: 'Not your turn' };
        if (!this.drawnCard) return { error: 'No card drawn' };

        if (handIndex < 0 || handIndex >= player.hand.length) {
            return { error: 'Invalid hand index' };
        }

        const oldCard = player.swapCard(handIndex, this.drawnCard);
        // Player now knows this card position since they chose to put it there
        player.markKnown(handIndex);

        this.deck.discard(oldCard);
        this.lastDiscard = oldCard;
        this.drawnCard = null;
        this.snapWindow = true;

        const result = {
            success: true,
            discarded: oldCard,
            handIndex: handIndex
        };

        // Don't auto-advance turn, wait for snap window
        return result;
    }

    // Discard drawn card without using it
    discardDrawnCard(playerId) {
        const player = this.getCurrentPlayer();
        if (!player || player.id !== playerId) return { error: 'Not your turn' };
        if (!this.drawnCard) return { error: 'No card drawn' };

        const card = this.drawnCard;
        this.deck.discard(card);
        this.lastDiscard = card;
        this.drawnCard = null;
        this.snapWindow = true;

        return {
            success: true,
            discarded: card
        };
    }

    // Use drawn card's power and discard it
    usePower(playerId) {
        const player = this.getCurrentPlayer();
        if (!player || player.id !== playerId) return { error: 'Not your turn' };
        if (!this.drawnCard) return { error: 'No card drawn' };

        const power = Deck.hasPower(this.drawnCard);
        if (!power) return { error: 'This card has no power' };

        // Queen swap requires 3+ players (swaps between OTHER players)
        if (power === 'queenSwap' && this.getConnectedPlayers().length < 3) {
            return { error: 'Queen swap requires 3+ players. Swap or discard instead.' };
        }

        this.pendingPower = {
            type: power,
            card: this.drawnCard,
            playerId: playerId
        };

        // Card will be discarded after power is resolved
        return {
            success: true,
            power: power,
            card: this.drawnCard
        };
    }

    // Double Drop: drawn card matches a hand card — discard both
    doubleDrop(playerId, handIndex, usePowerToo) {
        const player = this.getCurrentPlayer();
        if (!player || player.id !== playerId) return { error: 'Not your turn' };
        if (!this.drawnCard) return { error: 'No card drawn' };

        if (handIndex < 0 || handIndex >= player.hand.length) {
            return { error: 'Invalid hand index' };
        }

        const handCard = player.hand[handIndex];
        if (handCard.rank !== this.drawnCard.rank) {
            // PENALTY: wrong card! Player draws 2 extra cards
            const penaltyCards = [];
            for (let i = 0; i < 2; i++) {
                const penaltyCard = this.deck.draw();
                if (penaltyCard) {
                    player.hand.push(penaltyCard);
                    penaltyCards.push(penaltyCard);
                }
            }
            // Discard the drawn card
            this.deck.discard(this.drawnCard);
            this.lastDiscard = this.drawnCard;
            this.drawnCard = null;
            this.snapWindow = true;

            return {
                success: false,
                penalty: true,
                penaltyCount: penaltyCards.length,
                discardedDrawn: this.lastDiscard
            };
        }

        const power = Deck.hasPower(this.drawnCard);

        // Discard both cards
        const removedCard = player.removeCard(handIndex);
        this.deck.discard(removedCard);
        this.deck.discard(this.drawnCard);
        this.lastDiscard = this.drawnCard;

        const drawnCardCopy = this.drawnCard;
        this.drawnCard = null;
        this.snapWindow = true;

        // If power usage requested and card has a power
        if (usePowerToo && power) {
            this.pendingPower = {
                type: power,
                card: drawnCardCopy,
                playerId: playerId
            };

            return {
                success: true,
                doubleDropped: true,
                discardedHand: removedCard,
                discardedDrawn: drawnCardCopy,
                power: power,
                pendingPower: true
            };
        }

        return {
            success: true,
            doubleDropped: true,
            discardedHand: removedCard,
            discardedDrawn: drawnCardCopy,
            power: false,
            pendingPower: false
        };
    }

    // --- Power Resolutions ---

    // 7/8: Peek at one of your own cards
    resolvePeekOwn(playerId, cardIndex) {
        if (!this.pendingPower || this.pendingPower.type !== 'peekOwn') {
            return { error: 'No peek own power pending' };
        }

        const player = this.getPlayerById(playerId);
        if (!player) return { error: 'Player not found' };
        if (cardIndex < 0 || cardIndex >= player.hand.length) return { error: 'Invalid index' };

        player.markKnown(cardIndex);
        const card = player.hand[cardIndex];

        // Discard the power card
        this.deck.discard(this.pendingPower.card);
        this.lastDiscard = this.pendingPower.card;
        this.drawnCard = null;
        this.pendingPower = null;
        this.snapWindow = true;

        return {
            success: true,
            peekedCard: { index: cardIndex, card: card }
        };
    }

    // 9/10: Peek at another player's card
    resolvePeekOther(playerId, targetPlayerId, cardIndex) {
        if (!this.pendingPower || this.pendingPower.type !== 'peekOther') {
            return { error: 'No peek other power pending' };
        }

        if (playerId === targetPlayerId) return { error: 'Cannot peek at your own card with this power' };

        const targetPlayer = this.getPlayerById(targetPlayerId);
        if (!targetPlayer) return { error: 'Target player not found' };
        if (cardIndex < 0 || cardIndex >= targetPlayer.hand.length) return { error: 'Invalid index' };

        const card = targetPlayer.hand[cardIndex];

        // Discard the power card
        this.deck.discard(this.pendingPower.card);
        this.lastDiscard = this.pendingPower.card;
        this.drawnCard = null;
        this.pendingPower = null;
        this.snapWindow = true;

        return {
            success: true,
            peekedCard: { index: cardIndex, card: card, playerId: targetPlayerId }
        };
    }

    // Queen: Swap cards between any two players
    resolveQueenSwap(playerId, player1Id, card1Index, player2Id, card2Index) {
        if (!this.pendingPower || this.pendingPower.type !== 'queenSwap') {
            return { error: 'No queen swap power pending' };
        }

        const p1 = this.getPlayerById(player1Id);
        const p2 = this.getPlayerById(player2Id);
        if (!p1 || !p2) return { error: 'Player not found' };
        if (player1Id === player2Id) return { error: 'Must swap between different players' };
        if (card1Index < 0 || card1Index >= p1.hand.length) return { error: 'Invalid card index for player 1' };
        if (card2Index < 0 || card2Index >= p2.hand.length) return { error: 'Invalid card index for player 2' };

        // Swap the cards
        const temp = p1.hand[card1Index];
        p1.hand[card1Index] = p2.hand[card2Index];
        p2.hand[card2Index] = temp;

        // Both positions become unknown to both players
        p1.knownCards = p1.knownCards.filter(i => i !== card1Index);
        p2.knownCards = p2.knownCards.filter(i => i !== card2Index);

        // Discard the power card
        this.deck.discard(this.pendingPower.card);
        this.lastDiscard = this.pendingPower.card;
        this.drawnCard = null;
        this.pendingPower = null;
        this.snapWindow = true;

        return {
            success: true,
            swap: { player1Id, card1Index, player2Id, card2Index }
        };
    }

    // Black Jack: Peek at 2 of your cards, then swap one with another player's card
    resolveBlackJackPeek(playerId, indices) {
        if (!this.pendingPower || this.pendingPower.type !== 'blackJack') {
            return { error: 'No black jack power pending' };
        }

        const player = this.getPlayerById(playerId);
        if (!player) return { error: 'Player not found' };
        if (!Array.isArray(indices) || indices.length !== 2) return { error: 'Must peek at exactly 2 cards' };

        indices.forEach(i => player.markKnown(i));
        const peekedCards = indices.map(i => ({ index: i, card: player.hand[i] }));

        // Move to swap phase
        this.pendingPower.phase = 'swap';
        this.pendingPower.peekedIndices = indices;

        return {
            success: true,
            cards: peekedCards,
            nextPhase: 'swap'
        };
    }

    resolveBlackJackSwap(playerId, myCardIndex, targetPlayerId, targetCardIndex) {
        if (!this.pendingPower || this.pendingPower.type !== 'blackJack' || this.pendingPower.phase !== 'swap') {
            return { error: 'No black jack swap pending' };
        }

        const player = this.getPlayerById(playerId);
        const target = this.getPlayerById(targetPlayerId);
        if (!player || !target) return { error: 'Player not found' };
        if (playerId === targetPlayerId) return { error: 'Must swap with a different player' };

        // Swap the cards
        const temp = player.hand[myCardIndex];
        player.hand[myCardIndex] = target.hand[targetCardIndex];
        target.hand[targetCardIndex] = temp;

        // The swapped positions become unknown
        player.knownCards = player.knownCards.filter(i => i !== myCardIndex);
        target.knownCards = target.knownCards.filter(i => i !== targetCardIndex);

        // Discard the power card
        this.deck.discard(this.pendingPower.card);
        this.lastDiscard = this.pendingPower.card;
        this.drawnCard = null;
        this.pendingPower = null;
        this.snapWindow = true;

        return {
            success: true,
            swap: { myCardIndex, targetPlayerId, targetCardIndex }
        };
    }

    // Skip Black Jack swap (player decides not to swap)
    resolveBlackJackSkip(playerId) {
        if (!this.pendingPower || this.pendingPower.type !== 'blackJack' || this.pendingPower.phase !== 'swap') {
            return { error: 'No black jack swap pending' };
        }

        this.deck.discard(this.pendingPower.card);
        this.lastDiscard = this.pendingPower.card;
        this.drawnCard = null;
        this.pendingPower = null;
        this.snapWindow = true;

        return { success: true };
    }

    // --- Snap/Match Mechanic ---

    snapCard(playerId, cardIndex) {
        if (!this.snapWindow || !this.lastDiscard) {
            return { error: 'No snap available right now' };
        }

        const player = this.getPlayerById(playerId);
        if (!player) return { error: 'Player not found' };
        if (cardIndex < 0 || cardIndex >= player.hand.length) return { error: 'Invalid card index' };

        const snappedCard = player.hand[cardIndex];

        if (snappedCard.rank === this.lastDiscard.rank) {
            // Successful snap — discard the matching card
            player.removeCard(cardIndex);
            this.deck.discard(snappedCard);
            this.lastDiscard = snappedCard;

            return {
                success: true,
                matched: true,
                card: snappedCard,
                playerId: playerId,
                playerName: player.name
            };
        } else {
            // Failed snap — card is revealed and player gets a penalty card
            const penaltyCard = this.deck.draw();
            if (penaltyCard) {
                player.addCard(penaltyCard);
            }

            return {
                success: true,
                matched: false,
                revealedCard: snappedCard,
                cardIndex: cardIndex,
                playerId: playerId,
                playerName: player.name,
                penaltyCard: !!penaltyCard
            };
        }
    }

    // Steal: Take someone's card believing it matches the discard, give them one of yours
    stealCard(thiefId, targetId, targetCardIndex, thiefCardIndex) {
        if (!this.lastDiscard) return { error: 'No discard to match against' };

        const thief = this.getPlayerById(thiefId);
        const target = this.getPlayerById(targetId);
        if (!thief || !target) return { error: 'Player not found' };
        if (thiefId === targetId) return { error: 'Cannot steal from yourself' };
        if (targetCardIndex < 0 || targetCardIndex >= target.hand.length) return { error: 'Invalid target card index' };
        if (thiefCardIndex < 0 || thiefCardIndex >= thief.hand.length) return { error: 'Invalid thief card index' };

        const targetCard = target.hand[targetCardIndex];

        if (targetCard.rank === this.lastDiscard.rank) {
            // Successful steal
            // Swap the cards
            const thiefCard = thief.hand[thiefCardIndex];
            target.hand[targetCardIndex] = thiefCard;
            thief.hand[thiefCardIndex] = targetCard;

            // Discard the stolen card (which matches)
            thief.removeCard(thiefCardIndex);
            this.deck.discard(targetCard);
            this.lastDiscard = targetCard;

            // Target now has unknown card
            target.knownCards = target.knownCards.filter(i => i !== targetCardIndex);

            return {
                success: true,
                matched: true,
                stolenCard: targetCard,
                thiefId, targetId
            };
        } else {
            // Failed steal — thief gets penalty card
            const penaltyCard = this.deck.draw();
            if (penaltyCard) {
                thief.addCard(penaltyCard);
            }

            return {
                success: true,
                matched: false,
                revealedCard: targetCard,
                targetCardIndex,
                thiefId, targetId,
                penaltyCard: !!penaltyCard
            };
        }
    }

    // --- Cobra Call ---

    callCobra(playerId) {
        if (this.phase !== PHASES.PLAYING) return { error: 'Cannot call cobra now' };
        if (this.cobraCaller) return { error: 'Cobra already called' };

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) return { error: 'Player not found' };

        this.cobraCaller = playerId;
        this.cobraCallerIndex = playerIndex;
        this.phase = PHASES.COBRA_CALLED;
        this.turnsSinceCobra = 0;

        return {
            success: true,
            callerName: this.players[playerIndex].name
        };
    }

    // --- Turn Management ---

    nextTurn() {
        this.snapWindow = false;
        this.drawnCard = null;
        this.pendingPower = null;

        // Find next connected player
        let nextIndex = this.currentPlayerIndex;
        let attempts = 0;
        do {
            nextIndex = (nextIndex + 1) % this.players.length;
            attempts++;
        } while (!this.players[nextIndex].connected && attempts < this.players.length);

        // Check if cobra round is complete
        if (this.phase === PHASES.COBRA_CALLED) {
            this.turnsSinceCobra++;
            if (nextIndex === this.cobraCallerIndex) {
                // Round complete — score and end
                return this.endRound();
            }
        }

        this.currentPlayerIndex = nextIndex;

        return {
            success: true,
            nextPlayer: this.players[nextIndex],
            phase: this.phase
        };
    }

    // --- Round End & Scoring ---

    endRound() {
        this.phase = PHASES.ROUND_OVER;

        const results = this.players.map(p => ({
            id: p.id,
            name: p.name,
            hand: p.hand,
            score: p.getScore(),
            isCaller: p.id === this.cobraCaller
        }));

        // Sort by score
        results.sort((a, b) => a.score - b.score);

        const callerResult = results.find(r => r.isCaller);
        const callerScore = callerResult ? callerResult.score : Infinity;

        // Check if anyone ties with the caller
        const tiedWithCaller = results.find(r => !r.isCaller && r.score === callerScore);

        let winner;
        if (tiedWithCaller) {
            // Caller loses if someone ties
            winner = tiedWithCaller;
            callerResult.penalty = true;
        } else if (callerResult && callerResult.score === results[0].score) {
            // Caller has the lowest — they win
            winner = callerResult;
        } else {
            // Someone else has lower — they win
            winner = results[0];
            if (callerResult) callerResult.penalty = true;
        }

        winner.isWinner = true;

        // Update total scores
        for (const r of results) {
            const player = this.getPlayerById(r.id);
            if (player) {
                player.totalScore += r.score;
                if (r.penalty) player.totalScore += 10; // Penalty for failed cobra call
            }
        }

        return {
            roundOver: true,
            results: results,
            winner: { id: winner.id, name: winner.name, score: winner.score }
        };
    }

    // --- State Serialization ---

    getStateForPlayer(playerId) {
        const player = this.getPlayerById(playerId);
        const current = this.getCurrentPlayer();

        return {
            roomCode: this.roomCode,
            phase: this.phase,
            roundNumber: this.roundNumber,
            currentPlayer: current ? { id: current.id, name: current.name } : null,
            isYourTurn: current && current.id === playerId,
            yourHand: player ? player.getOwnHandView() : [],
            yourId: playerId,
            players: this.players.map(p => ({
                ...p.getPublicHandView(),
                isCurrentTurn: current && current.id === p.id,
                isYou: p.id === playerId,
                totalScore: p.totalScore
            })),
            deckCount: this.deck.remaining(),
            topDiscard: this.deck.getTopDiscard(),
            lastDiscard: this.lastDiscard,
            cobraCaller: this.cobraCaller,
            drawnCard: (current && current.id === playerId) ? this.drawnCard : null,
            pendingPower: (current && current.id === playerId) ? this.pendingPower : null,
            snapWindow: this.snapWindow
        };
    }
}

module.exports = { Game, PHASES };
