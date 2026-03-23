(function () {
    'use strict';

    var API_BASE = window.location.origin + '/api';
    var MIN_PASSWORD = 8;

    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    var loginPanel = document.getElementById('loginPanel');
    var registerPanel = document.getElementById('registerPanel');
    var heroTitle = document.getElementById('authHeroTitle');
    var heroText = document.getElementById('authHeroText');

    var loginHero = {
        title: 'Entre na sua conta',
        text: 'Organize rotinas, acompanhe o progresso e mantenha o foco no que importa.'
    };
    var registerHero = {
        title: 'Crie sua conta',
        text: 'Apenas leve alguns segundos para começar a treinar sua memória visual e atenção.'
    };

    function lucideRefresh() {
        var lib = typeof lucide !== 'undefined' ? lucide : null;
        if (lib && lib.createIcons) lib.createIcons();
    }

    function isRegisterUrl() {
        if (window.location.pathname.indexOf('/register') !== -1) return true;
        var v = new URLSearchParams(window.location.search).get('view');
        return v === 'register';
    }

    function showLoginView() {
        loginPanel.classList.remove('auth-panel--hidden');
        registerPanel.classList.add('auth-panel--hidden');
        loginPanel.setAttribute('aria-hidden', 'false');
        registerPanel.setAttribute('aria-hidden', 'true');
        heroTitle.textContent = loginHero.title;
        heroText.textContent = loginHero.text;
        document.title = 'EC ROUTINE — Entrar';
        if (window.history && window.history.replaceState && window.location.protocol !== 'file:') {
            window.history.replaceState({}, '', '/login');
        }
        lucideRefresh();
    }

    function showRegisterView() {
        registerPanel.classList.remove('auth-panel--hidden');
        loginPanel.classList.add('auth-panel--hidden');
        registerPanel.setAttribute('aria-hidden', 'false');
        loginPanel.setAttribute('aria-hidden', 'true');
        heroTitle.textContent = registerHero.title;
        heroText.textContent = registerHero.text;
        document.title = 'EC ROUTINE — Cadastro';
        if (window.history && window.history.replaceState && window.location.protocol !== 'file:') {
            window.history.replaceState({}, '', '/register');
        }
        lucideRefresh();
    }

    function clearText(el) {
        if (el) el.textContent = '';
    }

    function validateEmail(value) {
        return EMAIL_RE.test(String(value || '').trim());
    }

    function setLoginLoading(loading) {
        var btn = document.getElementById('loginSubmit');
        if (!btn) return;
        btn.disabled = !!loading;
        btn.classList.toggle('auth-btn--loading', !!loading);
        btn.setAttribute('aria-busy', loading ? 'true' : 'false');
        var l = btn.querySelector('.auth-btn-loading');
        if (l) l.setAttribute('aria-hidden', loading ? 'false' : 'true');
    }

    function setRegisterLoading(loading) {
        var btn = document.getElementById('registerSubmit');
        if (!btn) return;
        btn.disabled = !!loading;
        btn.classList.toggle('auth-btn--loading', !!loading);
        btn.setAttribute('aria-busy', loading ? 'true' : 'false');
        var l = btn.querySelector('.auth-btn-loading');
        if (l) l.setAttribute('aria-hidden', loading ? 'false' : 'true');
    }

    function persistSession(data) {
        if (data.token) localStorage.setItem('token', data.token);
        if (data.user) {
            if (data.user.name) localStorage.setItem('userName', data.user.name);
            if (data.user.id) localStorage.setItem('userId', data.user.id);
        }
    }

    function redirectDashboard() {
        window.location.href = '/dashboard';
    }

    /** Após login/cadastro: dashboard pode mostrar boas-vindas (se não houver rotinas) e ir a /create */
    function redirectAfterAuth() {
        try {
            sessionStorage.setItem('ec_post_login_welcome', '1');
        } catch (e) {}
        redirectDashboard();
    }

    async function handleLogin(e) {
        e.preventDefault();
        clearText(document.getElementById('loginEmailError'));
        clearText(document.getElementById('loginPasswordError'));
        clearText(document.getElementById('loginFormError'));

        var email = (document.getElementById('loginEmail').value || '').trim();
        var password = document.getElementById('loginPassword').value || '';

        var ok = true;
        if (!email) {
            document.getElementById('loginEmailError').textContent = 'Informe o e-mail.';
            ok = false;
        } else if (!validateEmail(email)) {
            document.getElementById('loginEmailError').textContent = 'E-mail inválido.';
            ok = false;
        }
        if (!password) {
            document.getElementById('loginPasswordError').textContent = 'Informe a senha.';
            ok = false;
        }
        if (!ok) return;

        setLoginLoading(true);
        try {
            var res = await fetch(API_BASE + '/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, password: password })
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) {
                document.getElementById('loginFormError').textContent = data.error || 'Não foi possível entrar.';
                return;
            }
            persistSession(data);
            redirectAfterAuth();
        } catch (err) {
            document.getElementById('loginFormError').textContent = 'Erro de rede. Tente novamente.';
        } finally {
            setLoginLoading(false);
        }
    }

    async function handleRegister(e) {
        e.preventDefault();
        ['regNameError', 'regEmailError', 'regPasswordError', 'regPasswordConfirmError', 'regTermsError', 'registerFormError'].forEach(function (id) {
            clearText(document.getElementById(id));
        });

        var name = (document.getElementById('regName').value || '').trim();
        var email = (document.getElementById('regEmail').value || '').trim();
        var password = document.getElementById('regPassword').value || '';
        var confirm = document.getElementById('regPasswordConfirm').value || '';
        var terms = document.getElementById('regTerms').checked;

        var ok = true;
        if (!name) {
            document.getElementById('regNameError').textContent = 'Informe o nome completo.';
            ok = false;
        }
        if (!email) {
            document.getElementById('regEmailError').textContent = 'Informe o e-mail.';
            ok = false;
        } else if (!validateEmail(email)) {
            document.getElementById('regEmailError').textContent = 'E-mail inválido.';
            ok = false;
        }
        if (!password) {
            document.getElementById('regPasswordError').textContent = 'Informe a senha.';
            ok = false;
        } else if (password.length < MIN_PASSWORD) {
            document.getElementById('regPasswordError').textContent = 'A senha deve ter pelo menos ' + MIN_PASSWORD + ' caracteres.';
            ok = false;
        }
        if (password !== confirm) {
            document.getElementById('regPasswordConfirmError').textContent = 'As senhas não coincidem.';
            ok = false;
        }
        if (!terms) {
            document.getElementById('regTermsError').textContent = 'Você precisa aceitar os Termos & Condições.';
            ok = false;
        }
        if (!ok) return;

        setRegisterLoading(true);
        try {
            var res = await fetch(API_BASE + '/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, email: email, password: password })
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) {
                document.getElementById('registerFormError').textContent = data.error || 'Não foi possível cadastrar.';
                return;
            }
            persistSession(data);
            redirectAfterAuth();
        } catch (err) {
            document.getElementById('registerFormError').textContent = 'Erro de rede. Tente novamente.';
        } finally {
            setRegisterLoading(false);
        }
    }

    function setupPasswordToggles() {
        document.querySelectorAll('.auth-toggle-password').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-target');
                var input = document.getElementById(id);
                if (!input) return;
                var show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
                var icon = btn.querySelector('i');
                if (icon) {
                    icon.setAttribute('data-lucide', show ? 'eye-off' : 'eye');
                    lucideRefresh();
                }
            });
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        lucideRefresh();
        setupPasswordToggles();

        document.getElementById('loginForm').addEventListener('submit', handleLogin);
        document.getElementById('registerForm').addEventListener('submit', handleRegister);

        document.getElementById('goRegister').addEventListener('click', function () {
            showRegisterView();
        });
        document.getElementById('goLogin').addEventListener('click', function () {
            showLoginView();
        });

        if (isRegisterUrl()) {
            showRegisterView();
        } else {
            showLoginView();
        }
    });
})();
