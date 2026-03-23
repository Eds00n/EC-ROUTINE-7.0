# 🔐 Configuração do Login com Google

## Passo a Passo para Configurar OAuth 2.0 do Google

### 1. Criar Projeto no Google Cloud Console

1. Acesse: https://console.cloud.google.com/
2. Crie um novo projeto ou selecione um existente
3. Ative a **Google+ API** ou **Google Identity Services**

### 2. Configurar OAuth Consent Screen

1. Vá em **APIs & Services** > **OAuth consent screen**
2. Escolha **External** (para testes) ou **Internal** (para uso interno)
3. Preencha:
   - **App name**: EC ROUTINE
   - **User support email**: Seu email
   - **Developer contact information**: Seu email
4. Clique em **Save and Continue**
5. Adicione escopos:
   - `email`
   - `profile`
   - `openid`
6. Salve e continue

### 3. Criar Credenciais OAuth 2.0

1. Vá em **APIs & Services** > **Credentials**
2. Clique em **Create Credentials** > **OAuth client ID**
3. Escolha **Web application**
4. Configure:
   - **Name**: EC ROUTINE Web Client
   - **Authorized JavaScript origins**: 
     - `http://localhost:3000`
     - `http://127.0.0.1:3000`
   - **Authorized redirect URIs**:
     - `http://localhost:3000`
     - `http://localhost:3000/dashboard.html`
5. Clique em **Create**
6. **Copie o Client ID** que será gerado

### 4. Configurar no Código

1. Abra o arquivo `script.js`
2. Encontre a linha:
   ```javascript
   googleClientId = 'YOUR_GOOGLE_CLIENT_ID';
   ```
3. Substitua `YOUR_GOOGLE_CLIENT_ID` pelo Client ID que você copiou

### 5. Testar

1. Reinicie o servidor: `npm start`
2. Acesse: `http://localhost:3000`
3. Clique em "Continuar com Google"
4. Faça login com sua conta Google

## ⚠️ Importante

- **Nunca compartilhe seu Client ID publicamente** em repositórios públicos
- Para produção, adicione seu domínio nas **Authorized JavaScript origins**
- O Client ID é público, mas mantenha o Client Secret seguro (se usar)

## 🔧 Alternativa Simples (Para Testes Rápidos)

Se você quiser testar rapidamente sem configurar o Google Cloud Console, pode usar uma abordagem alternativa onde o usuário insere o token manualmente, mas isso não é recomendado para produção.

## 📝 Exemplo de Client ID

```javascript
// Em script.js, linha ~175
googleClientId = '123456789-abcdefghijklmnop.apps.googleusercontent.com';
```

## 🆘 Problemas Comuns

### "Error 400: redirect_uri_mismatch"
- Verifique se adicionou `http://localhost:3000` nas **Authorized JavaScript origins**

### "Error 403: access_denied"
- Verifique se ativou a Google+ API ou Google Identity Services
- Verifique se o OAuth consent screen está configurado

### "One Tap não aparece"
- Isso é normal, o One Tap só aparece em certas condições
- O botão "Continuar com Google" ainda funcionará
