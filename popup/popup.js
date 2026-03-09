const loadingEl = document.getElementById('loading');
const loggedOutEl = document.getElementById('logged-out');
const loggedInEl = document.getElementById('logged-in');
const loginBtn = document.getElementById('login-btn');
const refreshBtn = document.getElementById('refresh-btn');
const refreshAuthBtn = document.getElementById('refresh-auth-btn');
const usernameEl = document.getElementById('username');
const statsEl = document.getElementById('stats');
const followCountEl = document.getElementById('follow-count');
const pendingCountEl = document.getElementById('pending-count');

function showState(state) {
    loadingEl.classList.toggle('active', state === 'loading');
    loggedOutEl.classList.toggle('active', state === 'logged-out');
    loggedInEl.classList.toggle('active', state === 'logged-in');
}

async function loadStatus() {
    showState('loading');

    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
        if (!status?.authenticated) {
            showState('logged-out');
            return;
        }

        const info = status.userInfo;
        usernameEl.textContent = info.username;
        statsEl.textContent = `${info.chapterCount.toLocaleString()} chapters read`;
        followCountEl.textContent = info.followCount.toLocaleString();
        pendingCountEl.textContent = status.pendingSyncs.toString();
        showState('logged-in');
    });
}

loginBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LOGIN' });
});

refreshBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'REFRESH_AUTH' }, (response) => {
        if (response?.ok) {
            loadStatus();
        }
    });
});

refreshAuthBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'REFRESH_AUTH' }, (response) => {
        if (response?.ok) {
            loadStatus();
        }
    });
});

loadStatus();