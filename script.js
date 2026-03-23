// Configuração da API
const API_URL = 'http://localhost:3000/api';

// Elementos DOM
const registerForm = document.getElementById('registerForm');
const googleBtn = document.getElementById('googleBtn');
const loginLink = document.getElementById('loginLink');
let isLoginMode = false;

// Função para fazer requisições à API
async function apiRequest(endpoint, options = {}) {
    try {
        const token = localStorage.getItem('token');
        const headers = {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
            ...options.headers
        };

        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });

        // Verificar se a resposta é JSON
        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            throw new Error(text || 'Erro na requisição');
        }

        if (!response.ok) {
            throw new Error(data.error || 'Erro na requisição');
        }

        return data;
    } catch (error) {
        console.error('Erro na requisição:', error);
        
        // Mensagens de erro mais amigáveis
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            throw new Error('Não foi possível conectar ao servidor. Certifique-se de que o servidor está rodando (npm start)');
        }
        
        throw error;
    }
}

// Handler de registro
async function handleRegister(e) {
    e.preventDefault();
    
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    // Validações
    if (name.length < 3) {
        alert('Nome deve ter pelo menos 3 caracteres');
        return;
    }
    
    if (!isValidEmail(email)) {
        alert('Por favor, insira um e-mail válido');
        return;
    }
    
    if (password.length < 6) {
        alert('Senha deve ter pelo menos 6 caracteres');
        return;
    }
    
    if (password !== confirmPassword) {
        alert('As senhas não coincidem');
        return;
    }

    try {
        const response = await apiRequest('/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, password })
        });

        // Salvar dados do usuário
        localStorage.setItem('token', response.token);
        localStorage.setItem('userName', response.user.name);
        localStorage.setItem('userId', response.user.id);
        localStorage.setItem('userEmail', response.user.email);
        
        // Redirecionar imediatamente para o dashboard
        window.location.href = 'dashboard.html';
    } catch (error) {
        alert(error.message || 'Erro ao criar conta. Tente novamente.');
        console.error('Erro no registro:', error);
    }
}

// Handler de login
async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    
    if (!isValidEmail(email)) {
        alert('Por favor, insira um e-mail válido');
        return;
    }
    
    if (password.length < 6) {
        alert('Senha deve ter pelo menos 6 caracteres');
        return;
    }

    try {
        const response = await apiRequest('/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        localStorage.setItem('token', response.token);
        localStorage.setItem('userName', response.user.name);
        localStorage.setItem('userId', response.user.id);
        
        window.location.href = 'dashboard.html';
    } catch (error) {
        alert(error.message || 'Email ou senha incorretos.');
    }
}

// Alternar entre modo registro e login
function toggleMode() {
    const nameInput = document.getElementById('name');
    const confirmInput = document.getElementById('confirmPassword');
    const submitBtn = registerForm.querySelector('button[type="submit"]');
    
    isLoginMode = !isLoginMode;
    
    if (isLoginMode) {
        // Modo login
        if (submitBtn) submitBtn.textContent = 'Entrar';
        if (nameInput) nameInput.closest('.form') ? nameInput.parentElement.style.display = 'none' : nameInput.style.display = 'none';
        if (confirmInput) confirmInput.closest('.form') ? confirmInput.parentElement.style.display = 'none' : confirmInput.style.display = 'none';
        if (loginLink) loginLink.innerHTML = 'Não tem uma conta? <a href="#" id="registerLink">Criar conta</a>';
        
        registerForm.removeEventListener('submit', handleRegister);
        registerForm.addEventListener('submit', handleLogin);
    } else {
        // Modo registro
        if (submitBtn) submitBtn.textContent = 'Criar Conta';
        if (nameInput) nameInput.style.display = 'block';
        if (nameInput && nameInput.parentElement) nameInput.parentElement.style.display = 'block';
        if (confirmInput) confirmInput.style.display = 'block';
        if (confirmInput && confirmInput.parentElement) confirmInput.parentElement.style.display = 'block';
        if (loginLink) loginLink.innerHTML = 'Já tem uma conta? <a href="#" id="loginLink">Entrar</a>';
        
        registerForm.removeEventListener('submit', handleLogin);
        registerForm.addEventListener('submit', handleRegister);
    }
}

// Event listeners
registerForm.addEventListener('submit', handleRegister);

loginLink.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMode();
});

// Configuração do Google OAuth
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID'; // Substitua pelo seu Client ID do Google Cloud Console

// Inicializar Google Identity Services
window.addEventListener('load', () => {
    if (window.google && window.google.accounts && GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID') {
        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredential
        });
    }
});

// Handler para credencial do Google (One Tap)
async function handleGoogleCredential(response) {
    try {
        const serverResponse = await apiRequest('/auth/google', {
            method: 'POST',
            body: JSON.stringify({ token: response.credential })
        });

        localStorage.setItem('token', serverResponse.token);
        localStorage.setItem('userName', serverResponse.user.name);
        localStorage.setItem('userId', serverResponse.user.id);
        if (serverResponse.user.picture) {
            localStorage.setItem('userPicture', serverResponse.user.picture);
        }
        
        window.location.href = 'dashboard.html';
    } catch (error) {
        console.error('Erro no login Google:', error);
        alert('Erro ao fazer login com Google: ' + error.message);
    }
}

// Botão Google
googleBtn.addEventListener('click', async () => {
    if (GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID') {
        // Modo desenvolvimento: permitir acesso sem Google configurado
        const useDevMode = confirm('⚠️ Login com Google não configurado!\n\nDeseja entrar em modo de desenvolvimento?\n\n(Isso criará uma conta temporária para você configurar o site)');
        
        if (useDevMode) {
            // Criar conta de desenvolvimento temporária
            try {
                const devEmail = `dev-${Date.now()}@ecroutine.local`;
                const devName = 'Usuário Desenvolvimento';
                const devPassword = 'dev123456';
                
                const response = await apiRequest('/register', {
                    method: 'POST',
                    body: JSON.stringify({ 
                        name: devName, 
                        email: devEmail, 
                        password: devPassword 
                    })
                });

                localStorage.setItem('token', response.token);
                localStorage.setItem('userName', response.user.name);
                localStorage.setItem('userId', response.user.id);
                
                alert('✅ Modo desenvolvimento ativado!\n\nVocê foi logado automaticamente.\n\nEmail: ' + devEmail + '\nSenha: ' + devPassword);
                window.location.href = 'dashboard.html';
                return;
            } catch (error) {
                // Se já existe, tentar fazer login
                try {
                    const loginResponse = await apiRequest('/login', {
                        method: 'POST',
                        body: JSON.stringify({ 
                            email: 'dev@ecroutine.local', 
                            password: 'dev123456' 
                        })
                    });
                    
                    localStorage.setItem('token', loginResponse.token);
                    localStorage.setItem('userName', loginResponse.user.name);
                    localStorage.setItem('userId', loginResponse.user.id);
                    
                    window.location.href = 'dashboard.html';
                    return;
                } catch (loginError) {
                    alert('Erro ao entrar em modo desenvolvimento. Use o formulário de registro normal.');
                }
            }
        }
        return;
    }

    try {
        // Usar Google Identity Services
        if (window.google && window.google.accounts) {
            // Tentar One Tap primeiro
            window.google.accounts.id.prompt((notification) => {
                if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                    // Se One Tap não funcionar, usar popup OAuth
                    const client = window.google.accounts.oauth2.initTokenClient({
                        client_id: GOOGLE_CLIENT_ID,
                        scope: 'email profile openid',
                        callback: async (tokenResponse) => {
                            try {
                                const serverResponse = await apiRequest('/auth/google', {
                                    method: 'POST',
                                    body: JSON.stringify({ token: tokenResponse.access_token })
                                });

                                localStorage.setItem('token', serverResponse.token);
                                localStorage.setItem('userName', serverResponse.user.name);
                                localStorage.setItem('userId', serverResponse.user.id);
                                if (serverResponse.user.picture) {
                                    localStorage.setItem('userPicture', serverResponse.user.picture);
                                }
                                
                                window.location.href = 'dashboard.html';
                            } catch (error) {
                                alert('Erro ao fazer login com Google: ' + error.message);
                            }
                        }
                    });
                    client.requestAccessToken();
                }
            });
        } else {
            alert('Google Identity Services não carregado. Verifique sua conexão com a internet.');
        }
    } catch (error) {
        console.error('Erro ao iniciar login Google:', error);
        alert('Erro ao iniciar login com Google: ' + error.message);
    }
});

// Validação de e-mail
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
