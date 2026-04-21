const BASE_URL = "https://misericordiasiracusa.it/api/index.php/";
const TRACKING_URL = "https://misericordiasiracusa.it/custom/trackinggps/update_position.php";

const STRINGS = {
    app_name: "CSM SR ODV",
    username: "Username",
    password: "Password",
    accedi: "Accedi",
    accetta: "Accetta",
    rifiuta: "Rifiuta",
    stato_attivo: "Stato: Attivo",
    stato_inattivo: "Stato: Inattivo",
    nome_servizio: "Nome Servizio",
    descrizione_servizio: "Descrizione",
    chiudi: "Chiudi",
    dettaglio_servizio: "Dettaglio Servizio",
    logout: "Logout",
    lista_servizi_attivi: "Lista Servizi Attivi",
    impostazioni: "Impostazioni",
    volontari: "Volontari: %1$s",
    risorse: "Risorse: %1$s",
    data_inizio: "Inizio: %1$s",
    data_fine: "Fine: %1$s",
    fasce_orarie: "Fasce Orarie: %1$s",
    tracking_gps: "Servizi",
    avvia_traccia: "Inizio Servizio",
    ferma_traccia: "Fine servizio",
    avvio_immediato: "Avvio immediato",
    nessun_servizio_attivo: "Nessun servizio attivo trovato",
    salva: "Salva",
    success_request: "Richiesta inviata con successo",
    error_request: "Errore nell'invio della richiesta"
};

let currentUser = null;
let selectedService = JSON.parse(localStorage.getItem('SELECTED_SERVICE')) || null;
let watchId = null;
let lastSentLat = null;
let lastSentLon = null;
let isFirstPoint = true; // Flag per identificare l'evento 'start'

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    registerServiceWorker();
});

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => {
                console.log('Service Worker registrato con successo:', reg.scope);
                // Controlla se c'è un aggiornamento in attesa
                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showToast("Nuovo aggiornamento disponibile! Ricarica la pagina.");
                        }
                    };
                };
            })
            .catch(err => console.error('Errore registrazione Service Worker:', err));
    }
}

function initApp() {
    setupEventListeners();
    applyInitialStrings();
    const token = localStorage.getItem('AUTH_TOKEN');
    if (token) {
        showPage('main');
        showSection('tracking');
        fetchUserData(token);

        // Ripristino automatico del tracking se era attivo
        if (localStorage.getItem('IS_TRACKING_ACTIVE') === 'true' && selectedService) {
            console.log("Ripristino tracking attivo dopo ricaricamento/background");
            startTracking(true); // Passiamo true per indicare che è un ripristino
        }
    } else {
        showPage('login');
    }
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function applyInitialStrings() {
    document.getElementById('modal-title').textContent = STRINGS.dettaglio_servizio;
    document.getElementById('btn-modal-close').textContent = STRINGS.chiudi;
    document.getElementById('btn-modal-accept').textContent = STRINGS.accetta;
    document.getElementById('btn-modal-reject').textContent = STRINGS.rifiuta;
    document.getElementById('btn-login').textContent = STRINGS.accedi;
    document.getElementById('username').placeholder = STRINGS.username;
    document.getElementById('password').placeholder = STRINGS.password;
}

function setupEventListeners() {
    const menuItems = { 'menu-services': 'services', 'menu-tracking': 'tracking', 'menu-settings': 'settings' };
    for (let id in menuItems) {
        const el = document.getElementById(id);
        if (el) el.onclick = () => showSection(menuItems[id]);
    }
    document.getElementById('menu-logout').onclick = () => { localStorage.clear(); location.reload(); };
    document.getElementById('btn-menu').onclick = openMenu;
    document.getElementById('drawer-overlay').onclick = closeMenu;
    document.getElementById('btn-login').onclick = attemptLogin;
    document.getElementById('btn-select-service-list').onclick = () => showSection('services');
    document.getElementById('btn-change-service').onclick = () => showSection('services');
    document.getElementById('btn-toggle-tracking').onclick = toggleTracking;
    document.getElementById('btn-save-settings').onclick = saveSettings;

    document.getElementById('btn-modal-accept').onclick = () => sendResponse('accepted');
    document.getElementById('btn-modal-reject').onclick = () => sendResponse('rejected');

    document.getElementById('btn-modal-close').onclick = () => document.getElementById('detail-modal').classList.add('hidden');
    document.getElementById('btn-refresh').onclick = () => { if (!document.getElementById('services-section').classList.contains('hidden')) loadServices(); };

    const btnToggle = document.getElementById('btn-toggle-password');
    if (btnToggle) {
        btnToggle.onclick = togglePasswordVisibility;
    }
}

function togglePasswordVisibility() {
    const pwd = document.getElementById('password');
    const icon = document.getElementById('btn-toggle-password');
    if (pwd.type === 'password') {
        pwd.type = 'text';
        icon.textContent = 'visibility';
    } else {
        pwd.type = 'password';
        icon.textContent = 'visibility_off';
    }
}

function openMenu() { document.getElementById('side-menu').classList.add('open'); document.getElementById('drawer-overlay').classList.remove('hidden'); }
function closeMenu() { document.getElementById('side-menu').classList.remove('open'); document.getElementById('drawer-overlay').classList.add('hidden'); }

function showPage(pageId) {
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('main-page').classList.add('hidden');
    const p = document.getElementById(pageId + '-page');
    if (p) p.classList.remove('hidden');
}

function showSection(sectionId) {
    closeMenu();
    ['services', 'tracking', 'settings'].forEach(s => document.getElementById(s + '-section').classList.add('hidden'));
    document.getElementById(sectionId + '-section').classList.remove('hidden');
    const title = document.getElementById('page-title');
    if (sectionId === 'services') { title.textContent = STRINGS.lista_servizi_attivi; loadServices(); }
    else if (sectionId === 'tracking') { title.textContent = STRINGS.tracking_gps; updateTrackingUI(); }
    else if (sectionId === 'settings') title.textContent = STRINGS.impostazioni;
}

async function loadServices() {
    const list = document.getElementById('services-list');
    list.innerHTML = '<div class="loader">Caricamento...</div>';
    const token = localStorage.getItem('AUTH_TOKEN');

    // Calcola il timestamp di oggi (inizio giornata)
    const d = new Date();
    d.setHours(0,0,0,0);
    const oggi = Math.floor(d.getTime() / 1000);

    // Usa MEMBER_ID se disponibile (ID Socio), altrimenti USER_ID come fallback
    const mid = localStorage.getItem('MEMBER_ID');
    const uid = localStorage.getItem('USER_ID');
    const volontarioId = (mid && mid !== "0") ? mid : (uid || 0);

    const url = `${BASE_URL}trackinggps/products_extrafields?date_from=${oggi}&volontario=${volontarioId}&limit=100`;

    console.log("Richiesta servizi a:", url);

    try {
        const res = await fetch(url, { headers: { 'DOLAPIKEY': token } });
        if (res.ok) {
            renderServices(await res.json());
        } else {
            const errorText = await res.text();
            list.innerHTML = `Errore server: ${res.status}`;
            console.error("Dettaglio Errore Server:", errorText);
            if (errorText.includes("Adherent"))            if (errorText.includes("Adherent")) {
                list.innerHTML += "<br><small>Errore: Classe Adherent mancante sul server</small>";
            }
        }
    } catch (e) {
        list.innerHTML = "Errore rete";
        console.error("Errore fetch:", e);
    }
}

function renderServices(services) {
    const list = document.getElementById('services-list');
    list.innerHTML = '';
    if (!services || services.length === 0) { list.innerHTML = STRINGS.nessun_servizio_attivo; return; }
    services.forEach(s => {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.innerHTML = `<h3>${s.label || s.ref}</h3><p>Ref: ${s.ref}</p><p>${s.data_inizio || ''}</p>`;
        card.onclick = () => openDetail(s);
        list.appendChild(card);
    });
}

function openDetail(service) {
    selectedService = service;
    document.getElementById('detail-name').textContent = service.label || service.ref;
    document.getElementById('detail-id').textContent = "ID: " + service.id + " (" + service.ref + ")";

    const descLabel = STRINGS.descrizione_servizio + ": ";
    const descContent = service.description && service.description !== 'null' ? service.description : "---";
    document.getElementById('detail-description').innerHTML = `<strong>${descLabel}</strong>${descContent}`;

    let vList = "---";
    if (service.volontari && Array.isArray(service.volontari)) {
        vList = service.volontari.map(v => v.fullname || (v.nome + " " + v.cognome)).join(", ");
    }
    document.getElementById('detail-volontari').textContent = STRINGS.volontari.replace('%1$s', vList);
    document.getElementById('detail-data-inizio').textContent = STRINGS.data_inizio.replace('%1$s', service.data_inizio || "--");

    const select = document.getElementById('fasce-select');
    select.innerHTML = '';
    let fasce = [];

    if (service.fascie_orarie) {
        if (Array.isArray(service.fascie_orarie)) {
            fasce = service.fascie_orarie;
        } else if (typeof service.fascie_orarie === 'string') {
            // Split per virgola o per nuova riga
            fasce = service.fascie_orarie.split(/,|\n/).map(f => f.trim()).filter(f => f !== "");
        }
    }

    if (fasce.length > 0) {
        document.getElementById('fasce-container').classList.remove('hidden');
        fasce.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            select.appendChild(opt);
        });
    } else {
        document.getElementById('fasce-container').classList.add('hidden');
    }

    document.getElementById('detail-modal').classList.remove('hidden');
}

async function sendResponse(statusValue) {
    const token = localStorage.getItem('AUTH_TOKEN');

    // Assicuriamoci di avere il MEMBER_ID prima di inviare
    let mid = localStorage.getItem('MEMBER_ID');
    if (!mid || mid === "0" || mid === "null") {
        console.log("MEMBER_ID mancante, provo a recuperarlo...");
        await fetchUserData(token);
        mid = localStorage.getItem('MEMBER_ID');
    }

    if (!mid || mid === "0" || mid === "null") {
        showToast("Errore: ID volontario non trovato. Riprova il login.");
        return;
    }

    const f = document.getElementById('fasce-select').value;
    const userComment = document.getElementById('detail-comment').value;

    // Se l'avvio è immediato, "prepariamo" il video per iOS immediatamente.
    // Questo assicura che il "permesso" del click utente non vada perso durante l'attesa del server.
    const isImmediate = (statusValue === 'accepted' && document.getElementById('sw-immediate').checked);
    if (isImmediate) {
        enableIOSBackground(true);
    }

    let finalResponse = (userComment && userComment.trim() !== '')
                        ? userComment
                        : (statusValue === 'accepted' ? "Accettato tramite PWA" : "Rifiutato tramite PWA");

    const url = `${BASE_URL}trackinggps/set_service_request`;
    const formData = new FormData();
    formData.append('service_id', selectedService.id);
    formData.append('member_id', mid);
    formData.append('fascia', f || "-");
    formData.append('status', statusValue);
    formData.append('response', finalResponse);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'DOLAPIKEY': token },
            body: formData
        });
        if (res.ok) {
            showToast(STRINGS.success_request + " (" + statusValue + ")");
            localStorage.setItem('SELECTED_SERVICE', JSON.stringify(selectedService));
            document.getElementById('detail-modal').classList.add('hidden');
            if (statusValue === 'accepted' && document.getElementById('sw-immediate').checked) {
                showSection('tracking');
                startTracking();
            } else showSection('tracking');
        } else {
            showToast(STRINGS.error_request + ": " + res.status);
        }
    } catch (e) {
        showToast("Errore di rete");
    }
}

function toggleTracking() { if (watchId) stopTracking(); else startTracking(); }

let lastSentTime = 0;

// Funzione per mantenere attiva la PWA su iOS in background tramite un video invisibile
function enableIOSBackground(active) {
    const video = document.getElementById('ios-background-video');
    if (!video) return;

    if (active) {
        // Un video base64 di 1x1 pixel, nero, silenzioso, durata brevissima (0.1s)
        if (!video.src) {
            video.src = "data:video/mp4;base64,AAAAHGZ0eXBpc29tAAAAAGlzb21pc28yYXZjMQAAAAhmcmVlAAAAAGxtZGF0AAAAEWF2Y2NDAWQAFf/hABhnZAAf69v8B8EBAf8AAAMAAQAAAwA8RIdrAgAUYmS7AAAAGGdtZGF0YXY0dgAB60AABAAAAMhtZGF0";
        }
        video.play().catch(e => console.log("Errore riproduzione video background:", e));
    } else {
        video.pause();
    }
}

let forceNextPoint = false;

function startTracking(isResume = false) {
    if (!navigator.geolocation) return alert("GPS non supportato");
    if (!selectedService) return alert("Seleziona prima un servizio");

    // Se è un nuovo avvio (non un ripristino), invia lo stato "Inizio" al server
    if (!isResume) {
        updateServerStatus(1);
        isFirstPoint = true;
        forceNextPoint = false;
    } else {
        // Se è un ripristino, non inviamo lo stato Start
        // e il prossimo punto sarà un semplice 'step'
        isFirstPoint = false;
        forceNextPoint = true; // Forziamo comunque l'invio del primo punto captato come conferma
    }

    lastSentLat = null;
    lastSentLon = null;
    lastSentTime = 0;

    // Attiva l'hack per iOS
    enableIOSBackground(true);

    // Salva lo stato attivo per il ripristino dopo il background
    localStorage.setItem('IS_TRACKING_ACTIVE', 'true');

    const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

    watchId = navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude } = pos.coords;
        const now = Date.now();

        let distance = (lastSentLat !== null) ? getDistance(lastSentLat, lastSentLon, latitude, longitude) : 0;
        let timeDiff = now - lastSentTime;

        // Invia se è il primo punto assoluto (START)
        // OPPURE se è il primo punto dopo un ripristino (STEP forzato)
        // OPPURE se sono passati almeno 30 secondi E mi sono spostato di almeno 10 metri (STEP)
        if (isFirstPoint || forceNextPoint || (timeDiff >= 30000 && distance >= 10)) {
            const eventType = isFirstPoint ? "start" : "step";

            document.getElementById('current-pos').textContent = `Posizione: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            document.getElementById('last-update').textContent = `Aggiornato: ${new Date().toLocaleTimeString()} (${isFirstPoint ? 'Inizio' : 'Ripristino/Delta ' + distance.toFixed(0) + 'm'})`;

            sendPosToServer(latitude, longitude, eventType);

            lastSentLat = latitude;
            lastSentLon = longitude;
            lastSentTime = now;
            isFirstPoint = false;
            forceNextPoint = false;
        }
    }, err => {
        document.getElementById('gps-status-text').textContent = "Errore GPS: " + err.message;
    }, options);

    updateTrackingUI();
}

function stopTracking() {
    if (watchId) {
        // Invio l'ultima posizione come STOP se l'abbiamo
        if (lastSentLat && lastSentLon) {
            sendPosToServer(lastSentLat, lastSentLon, "stop");
        }
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    lastSentLat = null; lastSentLon = null;
    updateServerStatus(0);

    // Rimuove lo stato attivo
    localStorage.setItem('IS_TRACKING_ACTIVE', 'false');

    // Disattiva l'hack per iOS
    enableIOSBackground(false);

    updateTrackingUI();
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function sendPosToServer(lat, lon, event = "step") {
    const token = localStorage.getItem('AUTH_TOKEN');
    const uid = localStorage.getItem('USER_ID');
    const name = localStorage.getItem('USER_FULLNAME');
    const sref = selectedService ? selectedService.ref : "";

    // Rilevamento OS e versione dallo User Agent
    let os = "unknown";
    let osVersion = "unknown";
    const ua = navigator.userAgent;

    if (/android/i.test(ua)) {
        os = "android";
        const match = ua.match(/Android\s([0-9\.]+)/);
        if (match) osVersion = match[1];
    } else if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) {
        os = "ios";
        const match = ua.match(/OS\s([0-9_]+)/);
        if (match) osVersion = match[1].replace(/_/g, '.');
    } else if (/Windows/i.test(ua)) {
        os = "windows";
    } else if (/Macintosh/i.test(ua)) {
        os = "mac_os";
    }

    const combinedSource = `pwa-${os}-${osVersion}`;
    const url = `${TRACKING_URL}?token=${token}&device_id=${uid}&service_ref=${sref}&label=${encodeURIComponent(name)}&lat=${lat}&lon=${lon}&source=${combinedSource}&event_type=${event}`;
    try { await fetch(url); } catch (e) {}
}

async function updateServerStatus(status) {
    const token = localStorage.getItem('AUTH_TOKEN');
    const uid = localStorage.getItem('USER_ID');
    const sid = selectedService ? selectedService.id : 0;
    const sref = selectedService ? selectedService.ref : "";

    const url = `${BASE_URL}trackinggps/set_tracking_status`;
    const formData = new FormData();
    formData.append('device_id', uid);
    formData.append('service_id', sid);
    formData.append('service_ref', sref);
    formData.append('status', status);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'DOLAPIKEY': token, 'Accept': 'application/json' },
            body: formData
        });
        if (res.ok) {
             const action = status === 1 ? "Inizio" : "Fine";
             showToast(action + " servizio inviato");
        }
        await res.text();
    } catch (e) {}
}

function updateTrackingUI() {
    const prompt = document.getElementById('selection-prompt');
    const card = document.getElementById('tracking-card');
    if (!selectedService) { prompt.classList.remove('hidden'); card.classList.add('hidden'); }
    else {
        prompt.classList.add('hidden'); card.classList.remove('hidden');
        document.getElementById('track-service-label').textContent = selectedService.label || selectedService.ref;
        document.getElementById('track-service-ref').textContent = selectedService.ref;
        const btn = document.getElementById('btn-toggle-tracking');
        const dot = document.getElementById('gps-status-dot');
        const txt = document.getElementById('gps-status-text');
        if (watchId) {
            btn.textContent = STRINGS.ferma_traccia; btn.classList.add('stop');
            dot.classList.add('active'); txt.textContent = STRINGS.stato_attivo;
        } else {
            btn.textContent = STRINGS.avvia_traccia; btn.classList.remove('stop');
            dot.classList.remove('active'); txt.textContent = STRINGS.stato_inattivo;
        }
    }
}

async function attemptLogin() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    try {
        const res = await fetch(`${BASE_URL}login?reset=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: u, password: p })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            localStorage.setItem('AUTH_TOKEN', data.success.token);
            await fetchUserData(data.success.token);
            showPage('main'); showSection('tracking');
            showToast("Login effettuato");
        } else {
            showToast("Login fallito");
        }
    } catch (e) { showToast("Errore di rete"); }
}

async function fetchUserData(token) {
    try {
        const res = await fetch(`${BASE_URL}users/info`, { headers: { 'DOLAPIKEY': token } });
        if (res.ok) {
            const user = await res.json();
            document.getElementById('user-full-name').textContent = (user.firstname || "") + " " + (user.lastname || "");
            localStorage.setItem('USER_ID', user.id);
            localStorage.setItem('USER_FULLNAME', (user.firstname || "") + " " + (user.lastname || ""));

            // Log per debug su iOS (visibile in console se collegato a Mac)
            console.log("Dati utente ricevuti:", user);

            // IMPORTANTE: Se il login ha restituito un token che NON è la API KEY,
            // e users/info ci restituisce la api_key reale, usiamo quella per il tracking.
            if (user.api_key) {
                localStorage.setItem('AUTH_TOKEN', user.api_key);
                console.log("Token aggiornato con API KEY statica");
            } else {
                console.warn("ATTENZIONE: api_key non ricevuta dal server. Il tracking potrebbe fallire.");
            }

            // Verifichiamo se fk_member è presente
            if (user.fk_member && user.fk_member !== "0") {
                localStorage.setItem('MEMBER_ID', user.fk_member);
                console.log("MEMBER_ID trovato e salvato: " + user.fk_member);
            } else {
                console.warn("L'utente non ha un fk_member associato.");
                localStorage.setItem('MEMBER_ID', "0");
            }
        }
    } catch (e) {
        console.error("Errore fetchUserData:", e);
    }
}

function saveSettings() {
    localStorage.setItem('PAGE_LIMIT', document.getElementById('set-page-limit').value);
    showToast(STRINGS.salva);
    showSection('services');
}
