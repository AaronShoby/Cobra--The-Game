// app.js — Main client application for Cobra card game

(function () {
    // --- Socket Connection ---
    const socket = io();

    // --- State ---
    let gameState = null;
    let myPlayerId = null;
    let roomCode = null;
    let isHost = false;
    let selectedPeekIndices = [];
    let swapMode = false;
    let doubleDropMode = false;
    let powerMode = null; // 'peekOwn' | 'peekOther' | 'queenSwap' | 'blackJack' | 'blackJackSwap'
    let powerSelections = {};
    let snapTimer = null;

    // --- DOM References ---
    const screens = {
        lobby: document.getElementById('lobbyScreen'),
        waiting: document.getElementById('waitingScreen'),
        game: document.getElementById('gameScreen')
    };

    const lobby = {
        tabCreate: document.getElementById('tabCreate'),
        tabJoin: document.getElementById('tabJoin'),
        createTab: document.getElementById('createTab'),
        joinTab: document.getElementById('joinTab'),
        createName: document.getElementById('createName'),
        joinName: document.getElementById('joinName'),
        joinCode: document.getElementById('joinCode'),
        btnCreate: document.getElementById('btnCreate'),
        btnJoin: document.getElementById('btnJoin'),
        error: document.getElementById('lobbyError')
    };

    const waiting = {
        roomCode: document.getElementById('roomCodeDisplay'),
        playersList: document.getElementById('playersList'),
        btnStart: document.getElementById('btnStartGame'),
        waitingText: document.getElementById('waitingText')
    };

    const game = {
        roomCode: document.getElementById('gameRoomCode'),
        roundBadge: document.getElementById('roundBadge'),
        turnInfo: document.getElementById('turnInfo'),
        btnCobra: document.getElementById('btnCobra'),
        opponentsArea: document.getElementById('opponentsArea'),
        deckCard: document.getElementById('deckCard'),
        deckCount: document.getElementById('deckCount'),
        discardCard: document.getElementById('discardCard'),
        drawnArea: document.getElementById('drawnArea'),
        drawnCardWrapper: document.getElementById('drawnCardWrapper'),
        drawnActions: document.getElementById('drawnActions'),
        btnSwap: document.getElementById('btnSwap'),
        btnUsePower: document.getElementById('btnUsePower'),
        btnDiscard: document.getElementById('btnDiscard'),
        yourHand: document.getElementById('yourHand'),
        modalOverlay: document.getElementById('modalOverlay'),
        actionModal: document.getElementById('actionModal'),
        modalTitle: document.getElementById('modalTitle'),
        modalDesc: document.getElementById('modalDesc'),
        modalContent: document.getElementById('modalContent'),
        modalActions: document.getElementById('modalActions'),
        toastContainer: document.getElementById('toastContainer'),
        snapBar: document.getElementById('snapBar'),
        snapBarFill: document.getElementById('snapBarFill'),
        btnEndTurn: document.getElementById('btnEndTurn'),
        roundOverScreen: document.getElementById('roundOverScreen'),
        roundOverTitle: document.getElementById('roundOverTitle'),
        scoreboard: document.getElementById('scoreboard'),
        btnNewRound: document.getElementById('btnNewRound'),
        peekOverlay: document.getElementById('peekOverlay'),
        peekCards: document.getElementById('peekCards'),
        btnConfirmPeek: document.getElementById('btnConfirmPeek')
    };

    // --- Screen Management ---
    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        if (screens[name]) screens[name].classList.add('active');
    }

    // --- Toast Notifications ---
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        game.toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // --- Lobby Tab Switching ---
    lobby.tabCreate.addEventListener('click', () => {
        lobby.tabCreate.classList.add('active');
        lobby.tabJoin.classList.remove('active');
        lobby.createTab.classList.remove('hidden');
        lobby.joinTab.classList.add('hidden');
    });

    lobby.tabJoin.addEventListener('click', () => {
        lobby.tabJoin.classList.add('active');
        lobby.tabCreate.classList.remove('active');
        lobby.joinTab.classList.remove('hidden');
        lobby.createTab.classList.add('hidden');
    });

    // --- Lobby Actions ---
    function showLobbyError(msg) {
        lobby.error.textContent = msg;
        lobby.error.classList.remove('hidden');
        setTimeout(() => lobby.error.classList.add('hidden'), 3000);
    }

    lobby.btnCreate.addEventListener('click', () => {
        const name = lobby.createName.value.trim();
        if (!name) return showLobbyError('Please enter your name');

        socket.emit('createRoom', { playerName: name }, (res) => {
            if (res.error) return showLobbyError(res.error);
            myPlayerId = res.playerId;
            roomCode = res.roomCode;
            isHost = true;
            showWaitingRoom();
        });
    });

    lobby.btnJoin.addEventListener('click', () => {
        const name = lobby.joinName.value.trim();
        const code = lobby.joinCode.value.trim();
        if (!name) return showLobbyError('Please enter your name');
        if (!code || code.length < 4) return showLobbyError('Please enter a valid room code');

        socket.emit('joinRoom', { roomCode: code, playerName: name }, (res) => {
            if (res.error) return showLobbyError(res.error);
            myPlayerId = res.playerId;
            roomCode = res.roomCode;
            isHost = false;
            showWaitingRoom();
        });
    });

    // Enter key support
    lobby.createName.addEventListener('keypress', (e) => { if (e.key === 'Enter') lobby.btnCreate.click(); });
    lobby.joinCode.addEventListener('keypress', (e) => { if (e.key === 'Enter') lobby.btnJoin.click(); });

    // --- Waiting Room ---
    function showWaitingRoom() {
        showScreen('waiting');
        waiting.roomCode.textContent = roomCode;
        waiting.btnStart.style.display = isHost ? 'inline-block' : 'none';
        waiting.waitingText.style.display = isHost ? 'none' : 'block';
    }

    function updateWaitingPlayers(players) {
        waiting.playersList.innerHTML = '';
        players.forEach((p, i) => {
            const div = document.createElement('div');
            div.className = 'player-item';
            div.innerHTML = `
        <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
        <span class="player-name">${p.name}</span>
        ${i === 0 ? '<span class="host-badge">Host</span>' : ''}
      `;
            waiting.playersList.appendChild(div);
        });

        // Show start button only if host and 2+ players
        if (isHost && players.length >= 2) {
            waiting.btnStart.style.display = 'inline-block';
        }
    }

    waiting.btnStart.addEventListener('click', () => {
        socket.emit('startGame', {}, (res) => {
            if (res.error) showToast(res.error, 'error');
        });
    });

    // --- Game Rendering ---
    function renderGame(state) {
        gameState = state;

        // Top bar
        game.roomCode.textContent = `Room: ${state.roomCode}`;
        game.roundBadge.textContent = `Round ${state.roundNumber}`;

        if (state.currentPlayer) {
            if (state.isYourTurn) {
                game.turnInfo.textContent = '🎯 Your Turn';
                game.turnInfo.style.color = 'var(--accent-primary)';
            } else {
                game.turnInfo.textContent = `${state.currentPlayer.name}'s Turn`;
                game.turnInfo.style.color = 'var(--text-secondary)';
            }
        }

        // Cobra button - visible when it's your turn and no cobra called yet
        game.btnCobra.style.display =
            (state.isYourTurn && state.phase === 'playing' && !state.cobraCaller && !state.drawnCard)
                ? 'inline-block' : 'none';

        // Deck
        game.deckCount.textContent = `${state.deckCount} cards`;
        game.deckCard.onclick = state.isYourTurn && !state.drawnCard && !powerMode
            ? () => handleDraw()
            : null;
        game.deckCard.style.cursor = (state.isYourTurn && !state.drawnCard && !powerMode) ? 'pointer' : 'default';

        // Discard pile
        renderDiscard(state.topDiscard);

        // Opponents
        renderOpponents(state);

        // Your hand
        renderYourHand(state);

        // Drawn card
        if (state.drawnCard && state.isYourTurn) {
            renderDrawnCard(state.drawnCard);
        } else if (!powerMode) {
            game.drawnArea.classList.add('hidden');
        }

        // End turn button
        if (state.isYourTurn && !state.drawnCard && !powerMode && state.phase !== 'initial_peek') {
            // Show end turn if we just discarded (snap window)
            game.btnEndTurn.classList.toggle('hidden', !state.snapWindow);
        } else {
            game.btnEndTurn.classList.add('hidden');
        }
    }

    function renderDiscard(card) {
        const container = document.getElementById('discardArea');
        container.innerHTML = '';
        if (card) {
            const el = createCardElement(card);
            container.appendChild(el);
        } else {
            const el = document.createElement('div');
            el.className = 'card discard-placeholder';
            el.innerHTML = '<span class="discard-label">Discard</span>';
            container.appendChild(el);
        }
    }

    function renderOpponents(state) {
        game.opponentsArea.innerHTML = '';
        const opponents = state.players.filter(p => !p.isYou);

        opponents.forEach(opp => {
            const zone = document.createElement('div');
            zone.className = 'opponent-zone';

            const nameEl = document.createElement('div');
            nameEl.className = `opponent-name ${opp.isCurrentTurn ? 'active-turn' : ''}`;
            nameEl.textContent = opp.name;
            if (!opp.connected) nameEl.textContent += ' (DC)';
            zone.appendChild(nameEl);

            const cardsEl = document.createElement('div');
            cardsEl.className = 'opponent-cards';

            for (let i = 0; i < opp.cardCount; i++) {
                const cardEl = createCardBack({
                    small: true,
                    selectable: powerMode === 'peekOther' || powerMode === 'queenSwap1' || powerMode === 'queenSwap2' || powerMode === 'blackJackSwap',
                    onClick: () => handleOpponentCardClick(opp.id, i)
                });
                cardEl.dataset.playerId = opp.id;
                cardEl.dataset.cardIndex = i;
                cardsEl.appendChild(cardEl);
            }
            zone.appendChild(cardsEl);

            const scoreBadge = document.createElement('div');
            scoreBadge.className = 'opponent-score-badge';
            scoreBadge.textContent = `Total: ${opp.totalScore}`;
            zone.appendChild(scoreBadge);

            game.opponentsArea.appendChild(zone);
        });
    }

    function renderYourHand(state) {
        game.yourHand.innerHTML = '';

        const isSelectable = swapMode || doubleDropMode ||
            powerMode === 'peekOwn' || powerMode === 'blackJackPeek' ||
            powerMode === 'blackJackSwapOwn' ||
            powerMode === 'queenSwap1' || powerMode === 'queenSwap2' ||
            (state.snapWindow && state.lastDiscard);

        state.yourHand.forEach((slot, i) => {
            // Cards always render face-down — player must memorize!
            const cardEl = createCardBack({
                selectable: isSelectable,
                onClick: () => handleOwnCardClick(i)
            });
            cardEl.dataset.cardIndex = i;

            // Peeked indicator — subtle eye icon on cards the player has seen
            if (slot.known) {
                cardEl.classList.add('peeked');
                const indicator = document.createElement('div');
                indicator.className = 'card-peeked-indicator';
                indicator.textContent = '👁';
                indicator.title = 'You\'ve seen this card';
                cardEl.appendChild(indicator);
            }

            // Highlight if in snap window
            if (state.snapWindow && state.lastDiscard) {
                cardEl.classList.add('highlight-snap');
            }

            game.yourHand.appendChild(cardEl);
        });
    }

    function renderDrawnCard(card) {
        game.drawnArea.classList.remove('hidden');
        game.drawnCardWrapper.innerHTML = '';

        const cardEl = createCardElement(card, { showPower: true });
        game.drawnCardWrapper.appendChild(cardEl);

        const power = getCardPowerName(card);
        game.btnUsePower.style.display = power ? 'inline-block' : 'none';
        if (power) {
            game.btnUsePower.textContent = `⚡ ${power}`;
        }

        // Check for double drop — does the drawn card match any known card in hand?
        let existingDDBtn = document.getElementById('btnDoubleDrop');
        if (existingDDBtn) existingDDBtn.remove();

        if (gameState && gameState.yourHand) {
            const hasMatch = gameState.yourHand.some(slot => slot.known && slot.card && slot.card.rank === card.rank);
            if (hasMatch) {
                const ddBtn = document.createElement('button');
                ddBtn.id = 'btnDoubleDrop';
                ddBtn.className = 'btn btn-action btn-double-drop';
                ddBtn.textContent = `🔥 Double Drop${power ? ' + Power' : ''}`;
                ddBtn.addEventListener('click', () => {
                    doubleDropMode = true;
                    showToast('Select the matching card in your hand to double drop', 'info');
                    if (gameState) renderYourHand(gameState);
                });
                game.drawnActions.appendChild(ddBtn);
            }
        }
    }

    // --- Initial Peek ---
    function showInitialPeek() {
        game.peekOverlay.classList.remove('hidden');
        selectedPeekIndices = [];
        game.btnConfirmPeek.disabled = true;

        game.peekCards.innerHTML = '';
        for (let i = 0; i < 4; i++) {
            const card = createCardBack({
                selectable: true,
                onClick: () => togglePeekSelection(i)
            });
            card.dataset.index = i;
            card.id = `peek-card-${i}`;
            game.peekCards.appendChild(card);
        }
    }

    function togglePeekSelection(index) {
        const idx = selectedPeekIndices.indexOf(index);
        if (idx >= 0) {
            selectedPeekIndices.splice(idx, 1);
        } else if (selectedPeekIndices.length < 2) {
            selectedPeekIndices.push(index);
        }

        // Update visual
        for (let i = 0; i < 4; i++) {
            const el = document.getElementById(`peek-card-${i}`);
            if (el) {
                el.classList.toggle('selected', selectedPeekIndices.includes(i));
            }
        }

        game.btnConfirmPeek.disabled = selectedPeekIndices.length !== 2;
    }

    game.btnConfirmPeek.addEventListener('click', () => {
        if (selectedPeekIndices.length !== 2) return;

        socket.emit('initialPeek', { indices: selectedPeekIndices }, (res) => {
            if (res.error) return showToast(res.error, 'error');

            // Show peeked cards briefly
            res.cards.forEach(c => {
                const el = document.getElementById(`peek-card-${c.index}`);
                if (el) {
                    el.innerHTML = '';
                    const faceEl = createCardElement(c.card);
                    el.replaceWith(faceEl);
                }
            });

            showToast('Memorize your cards! They will be hidden soon.', 'info');

            setTimeout(() => {
                game.peekOverlay.classList.add('hidden');
            }, 3000);
        });
    });

    // --- Game Actions ---
    function handleDraw() {
        if (!gameState || !gameState.isYourTurn || gameState.drawnCard) return;

        socket.emit('drawCard', {}, (res) => {
            if (res.error) return showToast(res.error, 'error');
            swapMode = false;
            doubleDropMode = false;
            powerMode = null;
        });
    }

    game.btnSwap.addEventListener('click', () => {
        swapMode = true;
        powerMode = null;
        showToast('Click a card in your hand to swap', 'info');
        if (gameState) renderYourHand(gameState);
    });

    game.btnDiscard.addEventListener('click', () => {
        socket.emit('discardDrawn', {}, (res) => {
            if (res.error) return showToast(res.error, 'error');
            swapMode = false;
            powerMode = null;
            game.drawnArea.classList.add('hidden');
            showSnapBar();
        });
    });

    game.btnUsePower.addEventListener('click', () => {
        socket.emit('usePower', {}, (res) => {
            if (res.error) return showToast(res.error, 'error');
            game.drawnArea.classList.add('hidden');
            startPowerMode(res.power);
        });
    });

    function startPowerMode(power) {
        swapMode = false;
        powerSelections = {};

        switch (power) {
            case 'peekOwn':
                powerMode = 'peekOwn';
                showToast('Select one of YOUR cards to peek at', 'info');
                break;
            case 'peekOther':
                powerMode = 'peekOther';
                showToast("Select one of another player's cards to peek at", 'info');
                break;
            case 'queenSwap':
                powerMode = 'queenSwap1';
                showModal('Queen Swap', 'Select the first card to swap (from any player)', '');
                showToast('Select the first card to swap', 'info');
                break;
            case 'blackJack':
                powerMode = 'blackJackPeek';
                showToast('Select 2 of YOUR cards to peek at', 'info');
                powerSelections.peekIndices = [];
                break;
        }

        if (gameState) {
            renderYourHand(gameState);
            renderOpponents(gameState);
        }
    }

    function handleOwnCardClick(index) {
        if (!gameState) return;

        // Double Drop mode: discard both drawn + matching hand card
        if (doubleDropMode && gameState.drawnCard) {
            const usePower = !!getCardPowerName(gameState.drawnCard);
            socket.emit('doubleDrop', { handIndex: index, usePower }, (res) => {
                if (res.error) return showToast(res.error, 'error');
                doubleDropMode = false;
                game.drawnArea.classList.add('hidden');
                showToast('🔥 Double Drop! Both cards discarded!', 'success');
                if (res.pendingPower) {
                    startPowerMode(res.power);
                } else {
                    showSnapBar();
                }
            });
            return;
        }

        // Swap mode: swap drawn card with hand card
        if (swapMode && gameState.drawnCard) {
            socket.emit('swapWithHand', { handIndex: index }, (res) => {
                if (res.error) return showToast(res.error, 'error');
                swapMode = false;
                game.drawnArea.classList.add('hidden');
                showSnapBar();
            });
            return;
        }

        // Peek Own power
        if (powerMode === 'peekOwn') {
            socket.emit('resolvePeekOwn', { cardIndex: index }, (res) => {
                if (res.error) return showToast(res.error, 'error');
                powerMode = null;

                const card = res.peekedCard.card;
                showModal(
                    '👁 Card Revealed',
                    `Position ${index + 1}`,
                    createCardElement(card).outerHTML,
                    [{ text: 'Got it!', action: () => { hideModal(); showSnapBar(); } }]
                );
            });
            return;
        }

        // Black Jack Peek
        if (powerMode === 'blackJackPeek') {
            const indices = powerSelections.peekIndices;
            const idx = indices.indexOf(index);
            if (idx >= 0) {
                indices.splice(idx, 1);
            } else if (indices.length < 2) {
                indices.push(index);
            }

            // Update selection visuals
            document.querySelectorAll('#yourHand .card').forEach((el, i) => {
                el.classList.toggle('selected', indices.includes(i));
            });

            if (indices.length === 2) {
                socket.emit('resolveBlackJackPeek', { indices }, (res) => {
                    if (res.error) return showToast(res.error, 'error');

                    const cardsHtml = res.cards.map(c =>
                        `<div style="display:inline-block; margin:4px;">${createCardElement(c.card).outerHTML}</div>`
                    ).join('');

                    powerMode = 'blackJackSwapOwn';
                    powerSelections.peekedCards = res.cards;

                    showModal(
                        '🃏 Black Jack — Your Cards',
                        'Now select one of YOUR cards to swap with another player\'s card. Or skip.',
                        cardsHtml,
                        [{
                            text: 'Skip Swap', action: () => {
                                socket.emit('resolveBlackJackSkip', {}, (r) => {
                                    powerMode = null;
                                    hideModal();
                                    showSnapBar();
                                });
                            }
                        }]
                    );
                });
            }
            return;
        }

        // Black Jack swap — selecting own card
        if (powerMode === 'blackJackSwapOwn') {
            powerSelections.myCardIndex = index;
            powerMode = 'blackJackSwap';
            hideModal();
            showToast("Now select another player's card to swap with", 'info');
            if (gameState) renderOpponents(gameState);
            return;
        }

        // Queen swap — own card selection
        if (powerMode === 'queenSwap1' || powerMode === 'queenSwap2') {
            handleQueenSelection(myPlayerId, index);
            return;
        }

        // Snap mode
        if (gameState.snapWindow && gameState.lastDiscard) {
            socket.emit('snapCard', { cardIndex: index }, (res) => {
                if (res.error) return showToast(res.error, 'error');
                if (res.matched) {
                    showToast('🎯 Snap! Card matched and discarded!', 'success');
                } else {
                    showToast('❌ Wrong card! Penalty card drawn.', 'error');
                }
            });
            return;
        }
    }

    function handleOpponentCardClick(playerId, cardIndex) {
        if (!gameState) return;

        // Peek Other power
        if (powerMode === 'peekOther') {
            socket.emit('resolvePeekOther', { targetPlayerId: playerId, cardIndex }, (res) => {
                if (res.error) return showToast(res.error, 'error');
                powerMode = null;

                const card = res.peekedCard.card;
                const targetName = gameState.players.find(p => p.id === playerId)?.name || 'Player';
                showModal(
                    '👁 Card Revealed',
                    `${targetName}'s card #${cardIndex + 1}`,
                    createCardElement(card).outerHTML,
                    [{ text: 'Got it!', action: () => { hideModal(); showSnapBar(); } }]
                );
            });
            return;
        }

        // Black Jack swap — selecting opponent's card
        if (powerMode === 'blackJackSwap') {
            socket.emit('resolveBlackJackSwap', {
                myCardIndex: powerSelections.myCardIndex,
                targetPlayerId: playerId,
                targetCardIndex: cardIndex
            }, (res) => {
                if (res.error) return showToast(res.error, 'error');
                powerMode = null;
                showToast('Cards swapped!', 'success');
                showSnapBar();
            });
            return;
        }

        // Queen swap
        if (powerMode === 'queenSwap1' || powerMode === 'queenSwap2') {
            handleQueenSelection(playerId, cardIndex);
            return;
        }

        // Steal attempt
        if (gameState.snapWindow && gameState.lastDiscard) {
            // Need to select which of own cards to give
            powerMode = 'steal';
            powerSelections.stealTarget = { targetId: playerId, targetCardIndex: cardIndex };
            showToast('Now select YOUR card to give them', 'info');
            if (gameState) renderYourHand(gameState);
            return;
        }
    }

    // Handle steal confirmation (own card click while in steal mode)
    function handleStealOwnCardClick(index) {
        if (powerMode !== 'steal') return;
        const { targetId, targetCardIndex } = powerSelections.stealTarget;

        socket.emit('stealCard', {
            targetId,
            targetCardIndex,
            myCardIndex: index
        }, (res) => {
            if (res.error) return showToast(res.error, 'error');
            powerMode = null;
            if (res.matched) {
                showToast('🎯 Steal successful!', 'success');
            } else {
                showToast('❌ Wrong card! Penalty card drawn.', 'error');
            }
        });
    }

    // Queen swap state machine
    function handleQueenSelection(playerId, cardIndex) {
        if (powerMode === 'queenSwap1') {
            powerSelections.player1Id = playerId;
            powerSelections.card1Index = cardIndex;
            powerMode = 'queenSwap2';
            const pName = gameState.players.find(p => p.id === playerId)?.name || 'You';
            showToast(`Selected ${pName}'s card #${cardIndex + 1}. Now select the second card.`, 'info');
            return;
        }

        if (powerMode === 'queenSwap2') {
            if (playerId === powerSelections.player1Id) {
                showToast('Must swap between different players!', 'warning');
                return;
            }

            socket.emit('resolveQueenSwap', {
                player1Id: powerSelections.player1Id,
                card1Index: powerSelections.card1Index,
                player2Id: playerId,
                card2Index: cardIndex
            }, (res) => {
                if (res.error) return showToast(res.error, 'error');
                powerMode = null;
                hideModal();
                showToast('Cards swapped between players!', 'success');
                showSnapBar();
            });
        }
    }

    // Cobra call
    game.btnCobra.addEventListener('click', () => {
        if (confirm('Are you sure you want to call COBRA? 🐍')) {
            socket.emit('callCobra', {}, (res) => {
                if (res.error) return showToast(res.error, 'error');
            });
        }
    });

    // End turn
    game.btnEndTurn.addEventListener('click', () => {
        clearSnapTimer();
        socket.emit('endTurn', {}, (res) => {
            if (res.error) return showToast(res.error, 'error');
        });
    });

    // New round
    game.btnNewRound.addEventListener('click', () => {
        socket.emit('newRound', {}, (res) => {
            if (res.error) return showToast(res.error, 'error');
            game.roundOverScreen.classList.add('hidden');
        });
    });

    // --- Snap Bar ---
    function showSnapBar() {
        game.snapBar.classList.remove('hidden');
        // Reset animation
        game.snapBarFill.style.animation = 'none';
        game.snapBarFill.offsetHeight; // Trigger reflow
        game.snapBarFill.style.animation = 'snapCountdown 5s linear forwards';

        clearSnapTimer();
        snapTimer = setTimeout(() => {
            game.snapBar.classList.add('hidden');
        }, 5000);
    }

    function clearSnapTimer() {
        if (snapTimer) {
            clearTimeout(snapTimer);
            snapTimer = null;
        }
        game.snapBar.classList.add('hidden');
    }

    // --- Modal ---
    function showModal(title, desc, contentHtml, buttons = []) {
        game.modalTitle.textContent = title;
        game.modalDesc.textContent = desc;
        game.modalContent.innerHTML = contentHtml;
        game.modalActions.innerHTML = '';

        buttons.forEach(btn => {
            const el = document.createElement('button');
            el.className = 'btn btn-action';
            el.textContent = btn.text;
            el.addEventListener('click', btn.action);
            game.modalActions.appendChild(el);
        });

        game.modalOverlay.classList.remove('hidden');
    }

    function hideModal() {
        game.modalOverlay.classList.add('hidden');
    }

    // --- Round Over ---
    function showRoundOver(data) {
        game.roundOverScreen.classList.remove('hidden');

        const winner = data.winner;
        game.roundOverTitle.textContent = `🏆 ${winner.name} Wins! (Score: ${winner.score})`;

        game.scoreboard.innerHTML = '';
        data.results.forEach((r, i) => {
            const row = document.createElement('div');
            row.className = `score-row ${r.isWinner ? 'winner' : ''}`;

            let extras = '';
            if (r.isCaller) extras += '<span class="score-caller">🐍 Caller</span>';
            if (r.penalty) extras += '<span class="score-penalty">+10 penalty</span>';

            const handHtml = r.hand.map(card => createMiniCard(card).outerHTML).join('');

            row.innerHTML = `
        <span class="score-rank">#${i + 1}</span>
        <span class="score-name">${r.name} ${extras}</span>
        <div class="score-hand">${handHtml}</div>
        <span class="score-value">${r.score}</span>
      `;
            game.scoreboard.appendChild(row);
        });
    }

    // --- Socket Events ---
    socket.on('gameState', (state) => {
        const wasWaiting = !gameState || gameState.phase === 'waiting';
        renderGame(state);

        if (state.phase === 'waiting' || state.phase === 'round_over') {
            if (!document.getElementById('gameScreen').classList.contains('active')) {
                updateWaitingPlayers(state.players);
            }
        }

        if (state.phase === 'initial_peek' && wasWaiting) {
            showScreen('game');
            showInitialPeek();
        }

        if (state.phase === 'playing' || state.phase === 'cobra_called') {
            showScreen('game');
        }
    });

    socket.on('gameStarted', (data) => {
        showScreen('game');
        showToast(`Round ${data.roundNumber} started!`, 'info');
        game.roundOverScreen.classList.add('hidden');
        clearSnapTimer();
        powerMode = null;
        swapMode = false;
    });

    socket.on('playPhaseStarted', () => {
        game.peekOverlay.classList.add('hidden');
        showToast('Game on! Draw from the deck on your turn.', 'success');
    });

    socket.on('playerJoined', (data) => {
        showToast(`${data.name} joined! (${data.playerCount} players)`, 'info');
    });

    socket.on('playerDisconnected', (data) => {
        showToast(`${data.name} disconnected`, 'warning');
    });

    socket.on('cardDiscarded', (data) => {
        showToast(`${data.playerName} discarded ${data.card.rank} of ${data.card.suit}`, 'info');
    });

    socket.on('powerActivated', (data) => {
        showToast(`${data.playerName} used ${data.power} power!`, 'info');
    });

    socket.on('cardsSwapped', (data) => {
        showToast(`${data.playerName} swapped cards between ${data.player1} and ${data.player2}`, 'info');
    });

    socket.on('snapSuccess', (data) => {
        showToast(`🎯 ${data.playerName} snapped ${data.card.rank}!`, 'success');
    });

    socket.on('snapFail', (data) => {
        showToast(`❌ ${data.playerName} failed snap! Card revealed: ${data.revealedCard.rank} of ${data.revealedCard.suit}`, 'warning');
    });

    socket.on('stealSuccess', (data) => {
        showToast(`🎯 ${data.thiefName} stole from ${data.targetName}!`, 'success');
    });

    socket.on('stealFail', (data) => {
        showToast(`❌ ${data.thiefName}'s steal failed! Penalty card drawn.`, 'warning');
    });

    socket.on('cobraCalled', (data) => {
        showToast(`🐍 ${data.callerName} called COBRA! Last round of turns!`, 'error');
    });

    socket.on('roundOver', (data) => {
        clearSnapTimer();
        powerMode = null;
        swapMode = false;
        showRoundOver(data);
    });

    socket.on('disconnect', () => {
        showToast('Disconnected from server!', 'error');
    });

    socket.on('connect', () => {
        if (roomCode) {
            showToast('Reconnected!', 'success');
        }
    });
})();
