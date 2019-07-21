/*
    Copyright (C) 2017-2019 Kai Uwe Broulik <kde@privat.broulik.de>

    This program is free software; you can redistribute it and/or
    modify it under the terms of the GNU General Public License as
    published by the Free Software Foundation; either version 3 of
    the License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

let playerIds = [];

function currentPlayer() {
    let playerId = playerIds[playerIds.length - 1];
    if (!playerId) {
        // Returning empty object instead of null so you can call player.id returning undefined instead of throwing
        return {};
    }

    let segments = playerId.split("-");
    return {
        id: playerId,
        tabId: parseInt(segments[0]),
        frameId: parseInt(segments[1])
    };
}

function playerIdFromSender(sender) {
    return sender.tab.id + "-" + (sender.frameId || 0);
}

function sendPlayerTabMessage(player, action, payload) {
    if (!player) {
        return;
    }

    let message = {
        subsystem: "mpris",
        action: action
    };
    if (payload) {
        message.payload = payload;
    }

    chrome.tabs.sendMessage(player.tabId, message, {
        frameId: player.frameId
    });
}

function playerGone(playerId) {
    let oldPlayer = currentPlayer();

    var removedPlayerIdx = playerIds.indexOf(playerId);
    if (removedPlayerIdx > -1) {
        playerIds.splice(removedPlayerIdx, 1); // remove that player from the array
    }

    let newPlayer = currentPlayer();

    if (oldPlayer.id === newPlayer.id) {
        return;
    }

    // all players gone :(
    if (!newPlayer.id) {
        sendPortMessage("mpris", "gone");
        return;
    }

    // ask the now current player to identify to us
    // we can't just pretend "playing" as the other player might be paused
    sendPlayerTabMessage(newPlayer, "identify");
}

// when tab is closed, tell the player is gone
// below we also have a "gone" signal listener from the content script
// which is invoked in the onbeforeunload handler of the page
chrome.tabs.onRemoved.addListener((tabId) => {
    // Since we only get the tab id, search for all players from this tab and signal a "gone"
    let players = playerIds;
    players.forEach((playerId) => {
        if (playerId.startsWith(tabId + "-")) {
            playerGone(playerId);
        }
    });
});

// callbacks from host (Plasma) to our extension
addCallback("mpris", "raise", function (message) {
    let player = currentPlayer();
    if (player.tabId) {
        raiseTab(player.tabId);
    }
});

addCallback("mpris", ["play", "pause", "playPause", "stop", "next", "previous"], function (message, action) {
    sendPlayerTabMessage(currentPlayer(), action);
});

addCallback("mpris", "setFullscreen", (message) => {
    sendPlayerTabMessage(currentPlayer(), "setFullscreen", {
        fullscreen: message.fullscreen
    });
});

addCallback("mpris", "setVolume", function (message) {
    sendPlayerTabMessage(currentPlayer(), "setVolume", {
        volume: message.volume
    });
});

addCallback("mpris", "setLoop", function (message) {
    sendPlayerTabMessage(currentPlayer(), "setLoop", {
        loop: message.loop
    });
});

addCallback("mpris", "setPosition", function (message) {
    sendPlayerTabMessage(currentPlayer(), "setPosition", {
        position: message.position
    });
})

addCallback("mpris", "setPlaybackRate", function (message) {
    sendPlayerTabMessage(currentPlayer(), "setPlaybackRate", {
        playbackRate: message.playbackRate
    });
});

// callbacks from a browser tab to our extension
addRuntimeCallback("mpris", "playing", function (message, sender) {
    // Before Firefox 67 it ran extensions in incognito mode by default
    // so we disable media controls for them to prevent accidental private
    // information leak on lock screen or now playing auto status in a messenger
    if (!isNaN(firefoxVersion) && firefoxVersion < 67 && sender.tab.incognito) {
        return;
    }

    let playerId = playerIdFromSender(sender);

    let idx = playerIds.indexOf(playerId);
    if (idx > -1) {
        // Move it to the end of the list so it becomes current
        playerIds.push(playerIds.splice(idx, 1)[0]);
    } else {
        playerIds.push(playerId);
    }

    var payload = message || {};
    payload.tabTitle = sender.tab.title;
    payload.url = sender.tab.url;

    sendPortMessage("mpris", "playing", payload);
});

addRuntimeCallback("mpris", "gone", function (message, sender) {
    playerGone(playerIdFromSender(sender));
});

addRuntimeCallback("mpris", "stopped", function (message, sender) {
    // When player stopped, check if there's another one we could control now instead
    let playerId = playerIdFromSender(sender);
    if (currentPlayer().id === playerId) {
        if (playerIds.length > 1) {
            playerGone(playerId);
        }
    }
});

addRuntimeCallback("mpris", ["paused", "waiting", "canplay"], function (message, sender, action) {
    if (currentPlayer().id === playerIdFromSender(sender)) {
        sendPortMessage("mpris", action);
    }
});

addRuntimeCallback("mpris", ["duration", "timeupdate", "seeking", "seeked", "ratechange", "volumechange", "titlechange", "fullscreenchange"], function (message, sender, action) {
    if (currentPlayer().id === playerIdFromSender(sender)) {
        sendPortMessage("mpris", action, message);
    }
});

addRuntimeCallback("mpris", ["metadata", "callbacks"], function (message, sender, action) {
    if (currentPlayer().id === playerIdFromSender(sender)) {
        var payload = {};
        payload[action] = message;

        sendPortMessage("mpris", action, payload);
    }
});
