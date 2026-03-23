/**
 * Exige sessão (token) para usar o app. Sem token → /register (criar conta).
 * Não corre em páginas de autenticação nem em file:// (desenvolvimento local).
 */
(function () {
    if (window.location.protocol === 'file:') return;

    var path = window.location.pathname || '';
    var href = window.location.href || '';

    var onAuthPage =
        path.indexOf('/login') !== -1 ||
        path.indexOf('/register') !== -1 ||
        /auth\.html(\?|$|#)/i.test(href) ||
        /\/auth\.html$/i.test(path);

    if (onAuthPage) return;

    if (!localStorage.getItem('token')) {
        window.location.replace('/register');
    }
})();
