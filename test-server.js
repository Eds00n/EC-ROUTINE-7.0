// Script de teste para verificar se o servidor está funcionando
const http = require('http');

console.log('🔍 Testando conexão com o servidor...\n');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/register',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    }
};

const testData = JSON.stringify({
    name: 'Teste',
    email: 'teste@teste.com',
    password: '123456'
});

const req = http.request(options, (res) => {
    console.log(`✅ Servidor está respondendo!`);
    console.log(`Status: ${res.statusCode}`);
    console.log(`Headers:`, res.headers);
    
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('\n📦 Resposta do servidor:');
        try {
            const json = JSON.parse(data);
            console.log(JSON.stringify(json, null, 2));
        } catch (e) {
            console.log(data);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ ERRO ao conectar ao servidor:');
    console.error(error.message);
    console.error('\n💡 Possíveis causas:');
    console.error('1. Servidor não está rodando - execute: npm start');
    console.error('2. Porta 3000 está ocupada por outro processo');
    console.error('3. Firewall está bloqueando a conexão');
});

req.write(testData);
req.end();
