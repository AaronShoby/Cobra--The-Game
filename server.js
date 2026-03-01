// server.js — Express + Socket.io server for Cobra card game

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Game, PHASES } = require('./game/Game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Room storage
const rooms = new Map();

// Generate 4-letter room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));
    return code;
}

// Broadcast game state to all players in a room
function broadcastGameState(game) {
    for (const player of game.players) {
        if (player.connected) {
            io.to(player.socketId).emit('gameState', game.getStateForPlayer(player.id));
        }
    }
}

// Socket.io event handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    let currentRoom = null;
    let currentPlayerId = null;

    // --- Room Management ---

    socket.on('createRoom', ({ playerName }, callback) => {
        const roomCode = generateRoomCode();
        const game = new Game(roomCode);
        const player = game.addPlayer(playerName, socket.id);

        rooms.set(roomCode, game);
        currentRoom = roomCode;
        currentPlayerId = player.id;

        socket.join(roomCode);
        callback({ success: true, roomCode, playerId: player.id });

        broadcastGameState(game);
    });

    socket.on('joinRoom', ({ roomCode, playerName }, callback) => {
        const code = roomCode.toUpperCase();
        const game = rooms.get(code);

        if (!game) {
            return callback({ error: 'Room not found' });
        }
        if (game.phase !== PHASES.WAITING && game.phase !== PHASES.ROUND_OVER) {
            return callback({ error: 'Game already in progress' });
        }

        const player = game.addPlayer(playerName, socket.id);
        currentRoom = code;
        currentPlayerId = player.id;

        socket.join(code);
        callback({ success: true, roomCode: code, playerId: player.id });

        io.to(code).emit('playerJoined', { name: playerName, playerCount: game.players.length });
        broadcastGameState(game);
    });

    // --- Game Actions ---

    socket.on('startGame', (_, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.startGame();
        if (result.error) return callback(result);

        callback({ success: true });
        io.to(currentRoom).emit('gameStarted', { roundNumber: game.roundNumber });
        broadcastGameState(game);
    });

    socket.on('initialPeek', ({ indices }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.initialPeek(currentPlayerId, indices);
        if (result.error) return callback(result);

        callback(result);

        // Check if all players have peeked
        const allPeeked = game.players.every(p => p.knownCards.length >= 2);
        if (allPeeked) {
            // Delay play phase start so the last player can see their peeked cards
            setTimeout(() => {
                game.startPlaying();
                io.to(currentRoom).emit('playPhaseStarted');
                broadcastGameState(game);
            }, 4000);
        } else {
            broadcastGameState(game);
        }
    });

    socket.on('drawCard', (_, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.drawCard(currentPlayerId);
        if (result.error) return callback(result);

        callback(result);
        broadcastGameState(game);
    });

    socket.on('swapWithHand', ({ handIndex }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.swapWithHand(currentPlayerId, handIndex);
        if (result.error) return callback(result);

        callback(result);
        io.to(currentRoom).emit('cardDiscarded', {
            card: result.discarded,
            playerName: game.getPlayerById(currentPlayerId).name
        });
        broadcastGameState(game);

        // Start snap window timer
        startSnapTimer(game, currentRoom);
    });

    socket.on('discardDrawn', (_, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.discardDrawnCard(currentPlayerId);
        if (result.error) return callback(result);

        callback(result);
        io.to(currentRoom).emit('cardDiscarded', {
            card: result.discarded,
            playerName: game.getPlayerById(currentPlayerId).name
        });
        broadcastGameState(game);

        startSnapTimer(game, currentRoom);
    });

    socket.on('usePower', (_, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.usePower(currentPlayerId);
        if (result.error) return callback(result);

        callback(result);
        io.to(currentRoom).emit('powerActivated', {
            power: result.power,
            playerName: game.getPlayerById(currentPlayerId).name
        });
        broadcastGameState(game);
    });

    // Power resolutions
    socket.on('resolvePeekOwn', ({ cardIndex }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.resolvePeekOwn(currentPlayerId, cardIndex);
        if (result.error) return callback(result);

        callback(result);
        broadcastGameState(game);
        startSnapTimer(game, currentRoom);
    });

    socket.on('resolvePeekOther', ({ targetPlayerId, cardIndex }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.resolvePeekOther(currentPlayerId, targetPlayerId, cardIndex);
        if (result.error) return callback(result);

        callback(result);
        broadcastGameState(game);
        startSnapTimer(game, currentRoom);
    });

    socket.on('resolveQueenSwap', ({ player1Id, card1Index, player2Id, card2Index }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.resolveQueenSwap(currentPlayerId, player1Id, card1Index, player2Id, card2Index);
        if (result.error) return callback(result);

        callback(result);
        io.to(currentRoom).emit('cardsSwapped', {
            playerName: game.getPlayerById(currentPlayerId).name,
            player1: game.getPlayerById(player1Id).name,
            player2: game.getPlayerById(player2Id).name
        });
        broadcastGameState(game);
        startSnapTimer(game, currentRoom);
    });

    socket.on('resolveBlackJackPeek', ({ indices }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.resolveBlackJackPeek(currentPlayerId, indices);
        if (result.error) return callback(result);

        callback(result);
        broadcastGameState(game);
    });

    socket.on('resolveBlackJackSwap', ({ myCardIndex, targetPlayerId, targetCardIndex }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.resolveBlackJackSwap(currentPlayerId, myCardIndex, targetPlayerId, targetCardIndex);
        if (result.error) return callback(result);

        callback(result);
        broadcastGameState(game);
        startSnapTimer(game, currentRoom);
    });

    socket.on('resolveBlackJackSkip', (_, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.resolveBlackJackSkip(currentPlayerId);
        if (result.error) return callback(result);

        callback(result);
        broadcastGameState(game);
        startSnapTimer(game, currentRoom);
    });

    // Double Drop: discard drawn card + matching hand card
    socket.on('doubleDrop', ({ handIndex, usePower }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.doubleDrop(currentPlayerId, handIndex, usePower);
        if (result.error) return callback(result);

        callback(result);

        // Penalty path — wrong card selected
        if (result.penalty) {
            io.to(currentRoom).emit('doubleDropPenalty', {
                playerName: game.getPlayerById(currentPlayerId).name,
                penaltyCount: result.penaltyCount
            });
            broadcastGameState(game);
            startSnapTimer(game, currentRoom);
            return;
        }

        // Success path
        io.to(currentRoom).emit('doubleDrop', {
            playerName: game.getPlayerById(currentPlayerId).name,
            card: result.discardedDrawn
        });

        if (!result.pendingPower) {
            broadcastGameState(game);
            startSnapTimer(game, currentRoom);
        } else {
            io.to(currentRoom).emit('powerActivated', {
                power: result.power,
                playerName: game.getPlayerById(currentPlayerId).name
            });
            broadcastGameState(game);
        }
    });

    // Snap
    socket.on('snapCard', ({ cardIndex }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.snapCard(currentPlayerId, cardIndex);
        if (result.error) return callback(result);

        callback(result);

        if (result.matched) {
            io.to(currentRoom).emit('snapSuccess', {
                playerName: result.playerName,
                card: result.card
            });
        } else {
            io.to(currentRoom).emit('snapFail', {
                playerName: result.playerName,
                revealedCard: result.revealedCard
            });
        }
        broadcastGameState(game);
    });

    // Steal
    socket.on('stealCard', ({ targetId, targetCardIndex, myCardIndex }, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.stealCard(currentPlayerId, targetId, targetCardIndex, myCardIndex);
        if (result.error) return callback(result);

        callback(result);

        const thiefName = game.getPlayerById(currentPlayerId).name;
        const targetName = game.getPlayerById(targetId).name;

        if (result.matched) {
            io.to(currentRoom).emit('stealSuccess', { thiefName, targetName, card: result.stolenCard });
        } else {
            io.to(currentRoom).emit('stealFail', { thiefName, targetName, revealedCard: result.revealedCard });
        }
        broadcastGameState(game);
    });

    // Cobra
    socket.on('callCobra', (_, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.callCobra(currentPlayerId);
        if (result.error) return callback(result);

        callback(result);
        io.to(currentRoom).emit('cobraCalled', { callerName: result.callerName });
        broadcastGameState(game);
    });

    // End turn (after snap window)
    socket.on('endTurn', (_, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const currentPlayer = game.getCurrentPlayer();
        if (!currentPlayer || currentPlayer.id !== currentPlayerId) {
            return callback({ error: 'Not your turn' });
        }

        const result = game.nextTurn();
        callback(result);

        if (result.roundOver) {
            io.to(currentRoom).emit('roundOver', result);
        }
        broadcastGameState(game);
    });

    // New round
    socket.on('newRound', (_, callback) => {
        const game = rooms.get(currentRoom);
        if (!game) return callback({ error: 'Room not found' });

        const result = game.startGame();
        if (result.error) return callback(result);

        callback({ success: true });
        io.to(currentRoom).emit('gameStarted', { roundNumber: game.roundNumber });
        broadcastGameState(game);
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        if (currentRoom) {
            const game = rooms.get(currentRoom);
            if (game) {
                const player = game.removePlayer(socket.id);
                if (player) {
                    io.to(currentRoom).emit('playerDisconnected', { name: player.name });
                    broadcastGameState(game);
                }

                // Clean up empty rooms
                if (game.getConnectedPlayers().length === 0) {
                    rooms.delete(currentRoom);
                    console.log(`Room ${currentRoom} deleted (empty)`);
                }
            }
        }
    });
});

// Snap timer — auto-advance turn after 5 seconds
function startSnapTimer(game, roomCode) {
    if (game.snapTimeout) clearTimeout(game.snapTimeout);

    game.snapTimeout = setTimeout(() => {
        game.snapWindow = false;
        const result = game.nextTurn();

        if (result.roundOver) {
            io.to(roomCode).emit('roundOver', result);
        }
        broadcastGameState(game);
    }, 5000);
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🐍 Cobra Card Game Server running!`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Share this with friends on the same network!\n`);
});
