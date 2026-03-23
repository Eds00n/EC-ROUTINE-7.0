# EC ROUTINE - Sistema de Agendamento e Rotinas

Sistema completo de gerenciamento de rotinas com autenticação de usuários e armazenamento de dados.

## 🚀 Como usar

### 1. Instalar dependências
```bash
npm install
```

### 2. Iniciar o servidor
```bash
npm start
```

O servidor estará rodando em `http://localhost:3000`

### 3. Acessar o sistema
Abra seu navegador e acesse: `http://localhost:3000`

## 📁 Estrutura do Projeto

- `index.html` - Página de registro/login
- `dashboard.html` - Dashboard principal após login
- `server.js` - Servidor backend com API REST
- `data/` - Diretório onde os dados são armazenados (criado automaticamente)
  - `users.json` - Dados dos usuários
  - `routines.json` - Dados das rotinas
  - `attachments/` - Ficheiros anexos (imagens dos mapas mentais)
  - `attachments-index.json` - Índice de anexos por utilizador

## 🔌 API Endpoints

### Autenticação
- `POST /api/register` - Registrar novo usuário
- `POST /api/login` - Fazer login
- `GET /api/verify` - Verificar token (requer autenticação)

### Rotinas
- `GET /api/routines` - Listar rotinas do usuário (requer autenticação)
- `POST /api/routines` - Criar nova rotina (requer autenticação)
- `PUT /api/routines/:id` - Atualizar rotina (requer autenticação)
- `DELETE /api/routines/:id` - Deletar rotina (requer autenticação)

## 🔒 Segurança

- Senhas são criptografadas com bcrypt
- Autenticação via JWT (JSON Web Tokens)
- Cada usuário só acessa suas próprias rotinas

## 📝 Notas

- Os dados são armazenados em arquivos JSON localmente
- Para produção, considere usar um banco de dados (PostgreSQL, MongoDB, etc.)
- O JWT_SECRET deve ser alterado em produção

## 🔧 Operação e produção

### Backup dos dados
- Faça **cópias regulares** da pasta `data/`: `users.json`, `routines.json`, `attachments-index.json` e da pasta `attachments/`.
- Em caso de falha do servidor, restaure esses ficheiros para recuperar utilizadores, rotinas e anexos.

### Produção (HTTPS e API)
- Em produção use **HTTPS** para o servidor e para o frontend.
- Configure a variável/constante da URL da API no frontend (ex.: `API_URL`) para o domínio real (ex.: `https://api.seudominio.com/api`).
- Ajuste CORS no `server.js` se o frontend for servido noutro domínio.

## 🛡️ Operação e produção

### Backup dos dados
- Faça **backup regular** da pasta `data/`:
  - `data/users.json` – utilizadores
  - `data/routines.json` – rotinas e anotações
  - `data/attachments/` – ficheiros anexados (imagens dos mapas mentais)
  - `data/attachments-index.json` – índice de anexos por utilizador
- Recomenda-se cópias diárias ou antes de atualizações.

### Produção (HTTPS e API)
- Em **produção**, use **HTTPS** para o servidor e para o frontend.
- Configure a variável/URL da API no frontend (`API_URL` em `dashboard.js`) para o domínio real (ex.: `https://api.seudominio.com/api`).
- Ajuste CORS em `server.js` se o frontend for servido noutro domínio.
