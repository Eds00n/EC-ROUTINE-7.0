const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const multer = require('multer');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'seu-secret-key-aqui-mude-em-producao';

// Limite de body JSON (evita 413 em anotações grandes até migrarmos para upload de ficheiros)
app.use(express.json({ limit: '10mb' }));

// Middleware
app.use(cors());
app.use(express.static('.'));

// Rotas para páginas (evitar "Cannot GET /dashboard")
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/create', (req, res) => res.sendFile(path.join(__dirname, 'create.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'auth.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'auth.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Caminho para o arquivo de dados
const DATA_DIR = path.join(__dirname, 'data');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');
const ATTACHMENTS_INDEX_FILE = path.join(DATA_DIR, 'attachments-index.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROUTINES_FILE = path.join(DATA_DIR, 'routines.json');

const UPLOAD_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB por ficheiro
const UPLOAD_MAX_FILE_SIZE_MB = 20;

function makeAttachmentId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Garantir que o diretório de dados existe
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });
        
        // Criar arquivos se não existirem
        try {
            await fs.access(USERS_FILE);
        } catch {
            await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
        }
        
        try {
            await fs.access(ROUTINES_FILE);
        } catch {
            await fs.writeFile(ROUTINES_FILE, JSON.stringify([], null, 2));
        }
    } catch (error) {
        console.error('Erro ao criar diretório de dados:', error);
    }
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, ATTACHMENTS_DIR);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || (file.mimetype && file.mimetype.indexOf('png') !== -1 ? '.png' : file.mimetype && file.mimetype.indexOf('jpeg') !== -1 ? '.jpg' : '.bin');
        cb(null, makeAttachmentId() + ext);
    }
});
const uploadMiddleware = multer({
    storage,
    limits: { fileSize: UPLOAD_MAX_FILE_SIZE }
});

// Funções auxiliares para ler/escrever dados
async function readUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

async function writeUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

async function readRoutines() {
    try {
        const data = await fs.readFile(ROUTINES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

async function writeRoutines(routines) {
    await fs.writeFile(ROUTINES_FILE, JSON.stringify(routines, null, 2));
}

function getLocalDateStrServer(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Calcular progresso de uma rotina (sem tarefas: 100% se check-in hoje)
function calculateProgress(routine) {
    const today = getLocalDateStrServer(new Date());
    if (!routine.tasks || routine.tasks.length === 0) {
        if (routine.checkIns && routine.checkIns.includes(today)) {
            return 100;
        }
        return 0;
    }
    const completedTasks = routine.tasks.filter(t => t.completed).length;
    return Math.round((completedTasks / routine.tasks.length) * 100);
}

// Middleware de autenticação
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    });
}

// ==================== ROTAS DE AUTENTICAÇÃO ====================

// Registrar novo usuário
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        const users = await readUsers();

        // Verificar se o email já existe
        if (users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'Email já cadastrado' });
        }

        // Hash da senha
        const hashedPassword = await bcrypt.hash(password, 10);

        // Criar novo usuário
        const newUser = {
            id: Date.now().toString(),
            name,
            email,
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        await writeUsers(users);

        // Gerar token JWT
        const token = jwt.sign(
            { id: newUser.id, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Usuário criado com sucesso',
            token,
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email
            }
        });
    } catch (error) {
        console.error('Erro ao registrar usuário:', error);
        res.status(500).json({ error: 'Erro ao registrar usuário' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios' });
        }

        const users = await readUsers();
        const user = users.find(u => u.email === email);

        if (!user) {
            return res.status(401).json({ error: 'Email ou senha incorretos' });
        }

        if (!user.password) {
            return res.status(401).json({ error: 'Email ou senha incorretos' });
        }

        // Verificar senha
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou senha incorretos' });
        }

        // Gerar token JWT
        const token = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login realizado com sucesso',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Erro ao fazer login:', error);
        res.status(500).json({ error: 'Erro ao fazer login' });
    }
});

// Login com Google
app.post('/api/auth/google', async (req, res) => {
    try {
        const { token: googleToken } = req.body;

        if (!googleToken) {
            return res.status(400).json({ error: 'Token do Google é obrigatório' });
        }

        // Verificar token com Google (pode ser JWT do Identity Services ou Access Token)
        try {
            let googleResponse;
            
            // Tentar como JWT primeiro (Google Identity Services)
            try {
                // Decodificar JWT sem verificar (apenas para obter dados)
                const decoded = jwt.decode(googleToken);
                
                if (decoded && decoded.email) {
                    // É um JWT do Google Identity Services
                    googleResponse = { data: decoded };
                } else {
                    throw new Error('Não é JWT válido');
                }
            } catch (jwtError) {
                // Se não for JWT, tentar como Access Token
                googleResponse = await axios.get(
                    `https://www.googleapis.com/oauth2/v3/userinfo`,
                    {
                        headers: {
                            Authorization: `Bearer ${googleToken}`
                        }
                    }
                );
            }

            const userData = googleResponse.data;
            const googleId = userData.sub || userData.id || Date.now().toString();
            const email = userData.email;
            const name = userData.name || userData.given_name + ' ' + (userData.family_name || '') || email.split('@')[0];
            const picture = userData.picture || '';

            if (!email) {
                return res.status(400).json({ error: 'Não foi possível obter email do Google' });
            }

            const users = await readUsers();
            let user = users.find(u => u.email === email);

            // Se usuário não existe, criar novo
            if (!user) {
                user = {
                    id: Date.now().toString(),
                    name: name.trim(),
                    email,
                    googleId,
                    picture: picture || '',
                    password: null, // Usuários Google não têm senha
                    createdAt: new Date().toISOString()
                };

                users.push(user);
                await writeUsers(users);
            } else {
                // Atualizar dados do Google se necessário
                if (!user.googleId) {
                    user.googleId = googleId;
                }
                if (picture && !user.picture) {
                    user.picture = picture;
                }
                if (name && (!user.name || user.name === email.split('@')[0])) {
                    user.name = name.trim();
                }
                const userIndex = users.findIndex(u => u.id === user.id);
                users[userIndex] = user;
                await writeUsers(users);
            }

            // Gerar token JWT
            const token = jwt.sign(
                { id: user.id, email: user.email },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.json({
                message: 'Login com Google realizado com sucesso',
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    picture: user.picture || ''
                }
            });
        } catch (googleError) {
            console.error('Erro ao verificar token do Google:', googleError);
            return res.status(401).json({ 
                error: 'Token do Google inválido ou expirado',
                details: googleError.message 
            });
        }
    } catch (error) {
        console.error('Erro ao fazer login com Google:', error);
        res.status(500).json({ error: 'Erro ao fazer login com Google' });
    }
});

// Verificar token (usado para manter sessão)
app.get('/api/verify', authenticateToken, async (req, res) => {
    try {
        const users = await readUsers();
        const user = users.find(u => u.id === req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Erro ao verificar token:', error);
        res.status(500).json({ error: 'Erro ao verificar token' });
    }
});

// ==================== UPLOADS / ANEXOS ====================

function uploadSingle(req, res, next) {
    uploadMiddleware.single('file')(req, res, function (err) {
        if (err && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'Ficheiro demasiado grande. Máximo ' + UPLOAD_MAX_FILE_SIZE_MB + ' MB.' });
        }
        if (err) return next(err);
        next();
    });
}

async function readAttachmentsIndex() {
    try {
        const data = await fs.readFile(ATTACHMENTS_INDEX_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

async function writeAttachmentsIndex(index) {
    await fs.writeFile(ATTACHMENTS_INDEX_FILE, JSON.stringify(index, null, 2));
}

// Upload de ficheiro (imagens, etc.) — guarda em data/attachments e índice userId
app.post('/api/uploads', authenticateToken, uploadSingle, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
        }
        const attachmentId = req.file.filename;
        const index = await readAttachmentsIndex();
        index[attachmentId] = { userId: req.user.id, filename: req.file.filename };
        await writeAttachmentsIndex(index);
        const url = '/api/attachments/' + encodeURIComponent(attachmentId);
        res.status(201).json({
            attachmentId,
            url,
            size: req.file.size,
            mimeType: req.file.mimetype || ''
        });
    } catch (err) {
        console.error('Erro no upload:', err);
        res.status(500).json({ error: 'Erro ao guardar ficheiro' });
    }
});

// Servir ficheiro anexo por id — só o dono (userId) pode aceder
app.get('/api/attachments/:id', authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || id.indexOf('..') !== -1 || /[\\/]/.test(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        const index = await readAttachmentsIndex();
        const entry = index[id];
        if (!entry || entry.userId !== req.user.id) {
            return res.status(404).json({ error: 'Anexo não encontrado' });
        }
        const filePath = path.join(ATTACHMENTS_DIR, entry.filename);
        await fs.access(filePath);
        res.sendFile(path.resolve(filePath));
    } catch (e) {
        if (e.code === 'ENOENT') return res.status(404).json({ error: 'Anexo não encontrado' });
        res.status(500).json({ error: 'Erro ao obter anexo' });
    }
});

// ==================== ROTAS DE ROTINAS ====================

// Obter todas as rotinas do usuário
app.get('/api/routines', authenticateToken, async (req, res) => {
    try {
        const routines = await readRoutines();
        const userRoutines = routines.filter(r => r.userId === req.user.id);
        // Calcular progresso para cada rotina
        const routinesWithProgress = userRoutines.map(routine => ({
            ...routine,
            progress: calculateProgress(routine)
        }));
        res.json(routinesWithProgress);
    } catch (error) {
        console.error('Erro ao buscar rotinas:', error);
        res.status(500).json({ error: 'Erro ao buscar rotinas' });
    }
});

// Criar nova rotina
app.post('/api/routines', authenticateToken, async (req, res) => {
    try {
        const { title, description, tasks, schedule, planType, objectives, reasons, bulletType, context, tags } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'Título é obrigatório' });
        }

        const routines = await readRoutines();

        const newRoutine = {
            id: Date.now().toString(),
            userId: req.user.id,
            title,
            description: description || '',
            tasks: tasks || [],
            schedule: schedule || {},
            planType: planType || 'daily',
            objectives: objectives || '',
            reasons: reasons || '',
            bulletType: bulletType || 'task',
            ...(context !== undefined && { context: context || '' }),
            ...(tags !== undefined && { tags: Array.isArray(tags) ? tags : [] }),
            checkIns: [], // Array de datas ISO (YYYY-MM-DD) quando a rotina foi completada
            completed: false,
            progress: calculateProgress({ tasks: tasks || [] }),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        routines.push(newRoutine);
        await writeRoutines(routines);

        res.status(201).json(newRoutine);
    } catch (error) {
        console.error('Erro ao criar rotina:', error);
        res.status(500).json({ error: 'Erro ao criar rotina' });
    }
});

// Atualizar rotina
app.put('/api/routines/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, tasks, schedule, completed, planType, objectives, reasons, bulletType, context, tags, checkIns } = req.body;

        const routines = await readRoutines();
        const routineIndex = routines.findIndex(
            r => r.id === id && r.userId === req.user.id
        );

        if (routineIndex === -1) {
            return res.status(404).json({ error: 'Rotina não encontrada' });
        }

        const prev = routines[routineIndex];
        const updatedRoutine = {
            ...prev,
            ...(title && { title }),
            ...(description !== undefined && { description }),
            ...(tasks && { tasks }),
            ...(schedule && { schedule }),
            ...(completed !== undefined && { completed }),
            ...(planType !== undefined && { planType: planType || 'daily' }),
            ...(objectives !== undefined && { objectives: objectives || '' }),
            ...(reasons !== undefined && { reasons: reasons || '' }),
            ...(bulletType !== undefined && { bulletType: bulletType || 'task' }),
            ...(context !== undefined && { context: context || '' }),
            ...(tags !== undefined && { tags: Array.isArray(tags) ? tags : [] }),
            // Persistir checkIns enviado pelo cliente (conclusão do dia / heatmap)
            ...(checkIns !== undefined && { checkIns: Array.isArray(checkIns) ? checkIns : (prev.checkIns || []) }),
            updatedAt: new Date().toISOString()
        };

        // Recalcular progresso
        updatedRoutine.progress = calculateProgress(updatedRoutine);

        routines[routineIndex] = updatedRoutine;
        await writeRoutines(routines);

        res.json(updatedRoutine);
    } catch (error) {
        console.error('Erro ao atualizar rotina:', error);
        res.status(500).json({ error: 'Erro ao atualizar rotina' });
    }
});

// Deletar rotina
app.delete('/api/routines/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const routines = await readRoutines();
        const routineIndex = routines.findIndex(
            r => r.id === id && r.userId === req.user.id
        );

        if (routineIndex === -1) {
            return res.status(404).json({ error: 'Rotina não encontrada' });
        }

        routines.splice(routineIndex, 1);
        await writeRoutines(routines);

        res.json({ message: 'Rotina deletada com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar rotina:', error);
        res.status(500).json({ error: 'Erro ao deletar rotina' });
    }
});

// Marcar check-in (dia completo)
app.post('/api/routines/:id/checkin', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.body; // Data no formato YYYY-MM-DD (opcional, usa hoje se não fornecido)

        const routines = await readRoutines();
        const routineIndex = routines.findIndex(
            r => r.id === id && r.userId === req.user.id
        );

        if (routineIndex === -1) {
            return res.status(404).json({ error: 'Rotina não encontrada' });
        }

        // Usar data fornecida ou hoje
        const checkInDate = date || new Date().toISOString().split('T')[0];
        
        // Garantir que checkIns existe
        if (!routines[routineIndex].checkIns) {
            routines[routineIndex].checkIns = [];
        }

        // Adicionar check-in se não existir
        if (!routines[routineIndex].checkIns.includes(checkInDate)) {
            routines[routineIndex].checkIns.push(checkInDate);
            routines[routineIndex].checkIns.sort(); // Ordenar datas
            routines[routineIndex].updatedAt = new Date().toISOString();
            await writeRoutines(routines);
        }

        res.json({
            message: 'Check-in registrado com sucesso',
            checkIns: routines[routineIndex].checkIns
        });
    } catch (error) {
        console.error('Erro ao registrar check-in:', error);
        res.status(500).json({ error: 'Erro ao registrar check-in' });
    }
});

// ==================== ROTAS DE TAREFAS ====================

// Adicionar tarefa a uma rotina
app.post('/api/routines/:id/tasks', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { text } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Texto da tarefa é obrigatório' });
        }

        const routines = await readRoutines();
        const routineIndex = routines.findIndex(
            r => r.id === id && r.userId === req.user.id
        );

        if (routineIndex === -1) {
            return res.status(404).json({ error: 'Rotina não encontrada' });
        }

        const newTask = {
            id: Date.now().toString(),
            text: text.trim(),
            completed: false,
            createdAt: new Date().toISOString()
        };

        if (!routines[routineIndex].tasks) {
            routines[routineIndex].tasks = [];
        }
        routines[routineIndex].tasks.push(newTask);
        routines[routineIndex].progress = calculateProgress(routines[routineIndex]);
        routines[routineIndex].updatedAt = new Date().toISOString();

        await writeRoutines(routines);

        res.status(201).json(newTask);
    } catch (error) {
        console.error('Erro ao adicionar tarefa:', error);
        res.status(500).json({ error: 'Erro ao adicionar tarefa' });
    }
});

// Atualizar tarefa
app.put('/api/routines/:id/tasks/:taskId', authenticateToken, async (req, res) => {
    try {
        const { id, taskId } = req.params;
        const { text, completed, annotation, annotationDate, annotationsByDate } = req.body;

        const routines = await readRoutines();
        const routineIndex = routines.findIndex(
            r => r.id === id && r.userId === req.user.id
        );

        if (routineIndex === -1) {
            return res.status(404).json({ error: 'Rotina não encontrada' });
        }

        const taskIndex = routines[routineIndex].tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Tarefa não encontrada' });
        }

        if (text !== undefined) {
            routines[routineIndex].tasks[taskIndex].text = text.trim();
        }
        if (completed !== undefined) {
            routines[routineIndex].tasks[taskIndex].completed = completed;
        }
        if (annotation !== undefined) {
            const ann = annotation && typeof annotation === 'object'
                ? { type: annotation.type || '', data: annotation.data != null ? annotation.data : '' }
                : null;
            routines[routineIndex].tasks[taskIndex].annotation = ann;
            if (annotationDate && typeof annotationDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(annotationDate)) {
                const task = routines[routineIndex].tasks[taskIndex];
                if (!task.annotationsByDate || typeof task.annotationsByDate !== 'object') task.annotationsByDate = {};
                task.annotationsByDate[annotationDate] = ann;
            }
        }
        if (annotationsByDate !== undefined && annotationsByDate !== null && typeof annotationsByDate === 'object') {
            const task = routines[routineIndex].tasks[taskIndex];
            const existing = task.annotationsByDate && typeof task.annotationsByDate === 'object' ? task.annotationsByDate : {};
            const incoming = annotationsByDate;
            // Merge: keep existing dates not in request; for dates in request use request (evita perder anotações em race/refresh)
            const merged = { ...existing };
            Object.keys(incoming).forEach(function (dateKey) {
                if (Array.isArray(incoming[dateKey])) merged[dateKey] = incoming[dateKey];
                else if (incoming[dateKey] != null) merged[dateKey] = incoming[dateKey];
            });
            task.annotationsByDate = merged;
        }

        routines[routineIndex].progress = calculateProgress(routines[routineIndex]);
        routines[routineIndex].updatedAt = new Date().toISOString();

        // Re-read from file before writing to avoid overwriting concurrent updates (evita anotações sumindo)
        const latest = await readRoutines();
        const latestRi = latest.findIndex(r => r.id === id && r.userId === req.user.id);
        const latestTi = latestRi !== -1 && latest[latestRi].tasks ? latest[latestRi].tasks.findIndex(t => t.id === taskId) : -1;
        if (latestRi !== -1 && latestTi !== -1) {
            const ourTask = routines[routineIndex].tasks[taskIndex];
            const latestTask = latest[latestRi].tasks[latestTi];
            latestTask.text = ourTask.text;
            latestTask.completed = ourTask.completed;
            latestTask.annotation = ourTask.annotation;
            const existingByDate = latestTask.annotationsByDate && typeof latestTask.annotationsByDate === 'object' ? latestTask.annotationsByDate : {};
            const incomingByDate = ourTask.annotationsByDate && typeof ourTask.annotationsByDate === 'object' ? ourTask.annotationsByDate : {};
            latestTask.annotationsByDate = { ...existingByDate, ...incomingByDate };
            latest[latestRi].progress = calculateProgress(latest[latestRi]);
            latest[latestRi].updatedAt = new Date().toISOString();
            await writeRoutines(latest);
        } else {
            await writeRoutines(routines);
        }

        res.json(routines[routineIndex].tasks[taskIndex]);
    } catch (error) {
        console.error('Erro ao atualizar tarefa:', error);
        res.status(500).json({ error: 'Erro ao atualizar tarefa' });
    }
});

// Deletar tarefa
app.delete('/api/routines/:id/tasks/:taskId', authenticateToken, async (req, res) => {
    try {
        const { id, taskId } = req.params;

        const routines = await readRoutines();
        const routineIndex = routines.findIndex(
            r => r.id === id && r.userId === req.user.id
        );

        if (routineIndex === -1) {
            return res.status(404).json({ error: 'Rotina não encontrada' });
        }

        const taskIndex = routines[routineIndex].tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Tarefa não encontrada' });
        }

        routines[routineIndex].tasks.splice(taskIndex, 1);
        routines[routineIndex].progress = calculateProgress(routines[routineIndex]);
        routines[routineIndex].updatedAt = new Date().toISOString();

        await writeRoutines(routines);

        res.json({ message: 'Tarefa deletada com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar tarefa:', error);
        res.status(500).json({ error: 'Erro ao deletar tarefa' });
    }
});

// Inicializar servidor
async function startServer() {
    await ensureDataDir();
    
    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
        console.log(`📁 Dados armazenados em: ${DATA_DIR}`);
    });
}

startServer().catch(console.error);
