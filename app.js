// State Management
const state = {
    currentView: 'user', // 'user' or 'admin'
    isAdmin: false,
    config: {
        densityRule: 5000, // 1 dealer per 5000 inhabitants
        exclusiveCities: [], // Array of objects: { city, uf, validUntil }
        warningDays: 30 // Default warning period
    },
    selectedLocation: null, // { city, uf, ibgeId }
};

// DOM Elements
const elements = {
    views: {
        user: document.getElementById('user-view'),
        admin: document.getElementById('admin-view')
    },
    inputs: {
        cep: document.getElementById('cep-input'),
        dealers: document.getElementById('current-dealers'),
        adminPass: document.getElementById('admin-pass'),
        density: document.getElementById('density-rule'),
        warningDays: document.getElementById('warning-days'),
        exclusiveCity: document.getElementById('exclusive-city-input'),
        exclusiveUf: document.getElementById('exclusive-uf-input'),
        exclusiveDate: document.getElementById('exclusive-date')
    },
    buttons: {
        searchCep: document.getElementById('search-cep-btn'),
        check: document.getElementById('check-btn'),
        adminToggle: document.getElementById('admin-toggle'),
        login: document.getElementById('login-btn'),
        logout: document.getElementById('logout-btn'),
        saveDensity: document.getElementById('save-density'),
        saveWarning: document.getElementById('save-warning'),
        addExclusive: document.getElementById('add-exclusive-btn'),
        closeTutorial: document.getElementById('close-tutorial')
    },
    containers: {
        result: document.getElementById('result-container'),
        loginPanel: document.getElementById('login-panel'),
        adminPanel: document.getElementById('admin-panel'),
        exclusiveList: document.getElementById('exclusive-list'),
        locationDisplay: document.getElementById('location-display'),
        locationText: document.getElementById('location-text'),
        tutorialModal: document.getElementById('tutorial-modal'),
        alertDashboard: document.getElementById('alert-dashboard'),
        alertList: document.getElementById('alert-list')
    }
};

// --- Initialization ---
async function init() {
    loadConfig();
    checkTutorial();
    populateUfSelect();
    setupEventListeners();

    // Input Mask for CEP
    elements.inputs.cep.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 5) {
            value = value.substring(0, 5) + '-' + value.substring(5, 8);
        }
        e.target.value = value;
    });
}

// --- Tutorial ---
function checkTutorial() {
    const hasSeen = localStorage.getItem('dealerCheckTutorial');
    if (!hasSeen) {
        elements.containers.tutorialModal.classList.remove('hidden');
    }
}

function closeTutorial() {
    elements.containers.tutorialModal.classList.add('hidden');
    localStorage.setItem('dealerCheckTutorial', 'true');
}

// --- API Integration (ViaCEP & IBGE) ---
async function searchCep(cep) {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8) {
        showToast('CEP inválido. Digite 8 números.', 'error');
        return;
    }

    try {
        elements.buttons.searchCep.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        const data = await response.json();

        if (data.erro) {
            showToast('CEP não encontrado.', 'error');
            resetLocation();
        } else {
            state.selectedLocation = {
                city: data.localidade,
                uf: data.uf,
                ibgeId: data.ibge // ViaCEP returns IBGE code which is great
            };

            showLocation(data.localidade, data.uf);
        }
    } catch (error) {
        console.error('Erro ao buscar CEP:', error);
        showToast('Erro de conexão com ViaCEP.', 'error');
    } finally {
        elements.buttons.searchCep.innerHTML = '<i class="fa-solid fa-search"></i>';
    }
}

async function getCityPopulation(ibgeId) {
    try {
        // IBGE API: Agregado 6579 (Estimativa de População), Variável 9324, Último Período (-1), Nível Município (N6)
        const response = await fetch(`https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[${ibgeId}]`);
        const data = await response.json();

        // Parse response: data[0].resultados[0].series[0].serie[YEAR]
        const serie = data[0]?.resultados[0]?.series[0]?.serie;
        if (serie) {
            const populationStr = Object.values(serie)[0];
            return parseInt(populationStr);
        }
        throw new Error('Estrutura de dados inesperada do IBGE');
    } catch (error) {
        console.error('Erro ao consultar IBGE:', error);
        showToast('Erro ao obter população real. Usando estimativa.', 'warning');
        return 50000; // Fallback seguro
    }
}

// --- Logic ---
function checkAvailability(population, currentDealers) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find if city is exclusive and if exclusivity is still valid
    const exclusiveRule = state.config.exclusiveCities.find(
        item => item.city === state.selectedLocation.city && item.uf === state.selectedLocation.uf
    );

    let isExclusiveActive = false;

    if (exclusiveRule) {
        if (exclusiveRule.validUntil) {
            const validDate = new Date(exclusiveRule.validUntil);
            validDate.setHours(0, 0, 0, 0);

            // If validDate is today or future, it is active
            if (validDate >= today) {
                isExclusiveActive = true;
            }
        } else {
            // No date means permanent exclusivity
            isExclusiveActive = true;
        }
    }

    if (isExclusiveActive && currentDealers > 0) {
        // Privacy: Don't show the date to public, only generic message
        return {
            status: 'unavailable',
            reason: 'Cidade Exclusiva (Consulte a Matriz)'
        };
    }

    const maxDealers = Math.floor(population / state.config.densityRule);
    const remainingSlots = maxDealers - currentDealers;

    if (remainingSlots > 0) {
        return {
            status: 'available',
            slots: remainingSlots,
            max: maxDealers
        };
    } else {
        return {
            status: 'unavailable',
            reason: 'Limite populacional atingido',
            max: maxDealers
        };
    }
}


// --- UI Functions ---
function showLocation(city, uf) {
    elements.containers.locationText.textContent = `${city} - ${uf}`;
    elements.containers.locationDisplay.classList.remove('hidden');
    elements.buttons.check.disabled = false;
}

function resetLocation() {
    state.selectedLocation = null;
    elements.containers.locationDisplay.classList.add('hidden');
    elements.buttons.check.disabled = true;
    elements.containers.result.classList.add('hidden');
}

function showResult(result, population) {
    const container = elements.containers.result;
    container.classList.remove('hidden');

    let html = '';

    if (result.status === 'available') {
        html = `
            <div class="glass-card result-card">
                <div class="status-icon status-available"><i class="fa-solid fa-check-circle"></i></div>
                <h2 class="result-title gradient-text">Disponível</h2>
                <p>Esta praça comporta mais revendedores.</p>
                <div class="result-details">
                    <div class="detail-item">
                        <span class="detail-label">População Estimada</span>
                        <span class="detail-value">${population.toLocaleString()}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Vagas Abertas</span>
                        <span class="detail-value" style="color: var(--success)">+${result.slots}</span>
                    </div>
                </div>
            </div>
        `;
    } else {
        html = `
            <div class="glass-card result-card">
                <div class="status-icon status-unavailable"><i class="fa-solid fa-circle-xmark"></i></div>
                <h2 class="result-title" style="color: var(--danger)">Indisponível</h2>
                <p>${result.reason}</p>
                <div class="result-details">
                    <div class="detail-item">
                        <span class="detail-label">População Estimada</span>
                        <span class="detail-value">${population.toLocaleString()}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Limite da Praça</span>
                        <span class="detail-value">${result.max || 1}</span>
                    </div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 1rem;
        border-radius: 8px;
        border: 1px solid var(--glass-border);
        z-index: 1000;
        animation: slideUp 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function populateUfSelect() {
    const ufs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
    const select = elements.inputs.exclusiveUf;
    ufs.forEach(uf => {
        const option = document.createElement('option');
        option.value = uf;
        option.textContent = uf;
        select.appendChild(option);
    });
}

// --- Admin & Config ---
function loadConfig() {
    const saved = localStorage.getItem('dealerCheckConfig');
    if (saved) {
        state.config = JSON.parse(saved);
        elements.inputs.density.value = state.config.densityRule;
        elements.inputs.warningDays.value = state.config.warningDays || 30;
        renderExclusiveList();
    }
}

function saveConfig() {
    localStorage.setItem('dealerCheckConfig', JSON.stringify(state.config));
    showToast('Configurações salvas!', 'success');
}

function renderExclusiveList() {
    const list = elements.containers.exclusiveList;
    list.innerHTML = '';

    state.config.exclusiveCities.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'exclusive-item';

        let dateText = 'Permanente';
        if (item.validUntil) {
            const date = new Date(item.validUntil);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const isExpired = date < today;

            dateText = `Até ${date.toLocaleDateString('pt-BR')}`;
            if (isExpired) dateText += ' (Expirado)';
        }

        li.innerHTML = `
            <div class="exclusive-info">
                <span>${item.city} - ${item.uf}</span>
                <span class="exclusive-date">${dateText}</span>
            </div>
            <button onclick="removeExclusive(${index})" class="remove-btn"><i class="fa-solid fa-trash"></i></button>
        `;
        list.appendChild(li);
    });
}

function updateAlertDashboard() {
    const list = elements.containers.alertList;
    list.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const warningDays = state.config.warningDays || 30;

    let hasAlerts = false;

    state.config.exclusiveCities.forEach((item, index) => {
        if (!item.validUntil) return;

        const validDate = new Date(item.validUntil);
        validDate.setHours(0, 0, 0, 0);

        const diffTime = validDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Show if expiring soon (positive diffDays <= warning) or already expired (negative diffDays)
        if (diffDays <= warningDays) {
            hasAlerts = true;
            const card = document.createElement('div');
            card.className = 'alert-card';

            let statusText = '';
            if (diffDays < 0) {
                statusText = `Venceu há ${Math.abs(diffDays)} dias`;
            } else if (diffDays === 0) {
                statusText = 'Vence Hoje!';
            } else {
                statusText = `Vence em ${diffDays} dias`;
            }

            card.innerHTML = `
                <div class="alert-days">${statusText}</div>
                <div>${item.city} - ${item.uf}</div>
                <button onclick="renewExclusive(${index})" class="renew-btn">Renovar (+30 dias)</button>
            `;
            list.appendChild(card);
        }
    });

    if (hasAlerts) {
        elements.containers.alertDashboard.classList.remove('hidden');
    } else {
        elements.containers.alertDashboard.classList.add('hidden');
    }
}

window.removeExclusive = function (index) {
    state.config.exclusiveCities.splice(index, 1);
    saveConfig();
    renderExclusiveList();
    updateAlertDashboard();
};

window.renewExclusive = function (index) {
    const item = state.config.exclusiveCities[index];
    if (item && item.validUntil) {
        const current = new Date(item.validUntil);
        current.setDate(current.getDate() + 30);
        item.validUntil = current.toISOString().split('T')[0];
        saveConfig();
        renderExclusiveList();
        updateAlertDashboard();
        showToast(`Renovado para ${item.city}!`, 'success');
    }
};

// --- Event Listeners ---
function setupEventListeners() {
    // Tutorial
    elements.buttons.closeTutorial.addEventListener('click', closeTutorial);

    // CEP Search
    elements.buttons.searchCep.addEventListener('click', () => {
        searchCep(elements.inputs.cep.value);
    });

    elements.inputs.cep.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchCep(elements.inputs.cep.value);
    });

    // Check Button
    elements.buttons.check.addEventListener('click', async () => {
        if (!state.selectedLocation) return;

        const currentDealers = parseInt(elements.inputs.dealers.value) || 0;

        // Show loading state
        elements.buttons.check.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';
        elements.buttons.check.disabled = true;

        const population = await getCityPopulation(state.selectedLocation.ibgeId);

        // Restore button
        elements.buttons.check.innerHTML = 'Verificar Disponibilidade <i class="fa-solid fa-arrow-right"></i>';
        elements.buttons.check.disabled = false;

        const result = checkAvailability(population, currentDealers);
        showResult(result, population);
    });

    // Admin Toggle
    elements.buttons.adminToggle.addEventListener('click', () => {
        state.currentView = state.currentView === 'user' ? 'admin' : 'user';
        toggleView();
    });

    // Login
    elements.buttons.login.addEventListener('click', () => {
        if (elements.inputs.adminPass.value === 'admin123') {
            state.isAdmin = true;
            elements.containers.loginPanel.classList.add('hidden');
            elements.containers.adminPanel.classList.remove('hidden');
            updateAlertDashboard(); // Check alerts on login
        } else {
            showToast('Senha incorreta', 'error');
        }
    });

    // Logout
    elements.buttons.logout.addEventListener('click', () => {
        state.isAdmin = false;
        elements.containers.loginPanel.classList.remove('hidden');
        elements.containers.adminPanel.classList.add('hidden');
        elements.inputs.adminPass.value = '';
    });

    // Save Density
    elements.buttons.saveDensity.addEventListener('click', () => {
        state.config.densityRule = parseInt(elements.inputs.density.value);
        saveConfig();
    });

    // Save Warning
    elements.buttons.saveWarning.addEventListener('click', () => {
        state.config.warningDays = parseInt(elements.inputs.warningDays.value);
        saveConfig();
        updateAlertDashboard();
    });

    // Add Exclusive
    elements.buttons.addExclusive.addEventListener('click', () => {
        const city = elements.inputs.exclusiveCity.value;
        const uf = elements.inputs.exclusiveUf.value;
        const date = elements.inputs.exclusiveDate.value;

        if (city && uf) {
            state.config.exclusiveCities.push({
                city: city,
                uf: uf,
                validUntil: date || null
            });
            saveConfig();
            renderExclusiveList();
            updateAlertDashboard();

            // Clear inputs
            elements.inputs.exclusiveCity.value = '';
            elements.inputs.exclusiveUf.value = '';
            elements.inputs.exclusiveDate.value = '';
        } else {
            showToast('Preencha Cidade e UF', 'error');
        }
    });
}

function toggleView() {
    if (state.currentView === 'user') {
        elements.views.user.classList.remove('hidden');
        elements.views.user.classList.add('active');
        elements.views.admin.classList.add('hidden');
        elements.views.admin.classList.remove('active');
    } else {
        elements.views.user.classList.add('hidden');
        elements.views.user.classList.remove('active');
        elements.views.admin.classList.remove('hidden');
        elements.views.admin.classList.add('active');
    }
}

// Start
init();
