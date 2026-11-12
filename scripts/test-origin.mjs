import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedOrigin} from '../lib/request-origin.ts';

const request=(headers,url='http://0.0.0.0:3000/api/register')=>new Request(url,{method:'POST',headers});
test('acepta el host del navegador cuando la URL interna usa 0.0.0.0',()=>{
  assert.equal(isAllowedOrigin(request({host:'localhost:3000',origin:'http://localhost:3000'})),true);
});
test('acepta el origen HTTPS del proxy y conserva el puerto exacto',()=>{
  assert.equal(isAllowedOrigin(request({host:'rutas.example.com',origin:'https://rutas.example.com','x-forwarded-proto':'https'})),true);
  assert.equal(isAllowedOrigin(request({host:'localhost:3000',origin:'http://localhost:4000'})),false);
});
test('rechaza dominios externos, null, protocolo diferente y Host reenviado manipulable',()=>{
  for(const origin of ['https://otro.example','null','https://localhost:3000','http://localhost:3000.evil.example'])
    assert.equal(isAllowedOrigin(request({host:'localhost:3000',origin})),false);
  assert.equal(isAllowedOrigin(request({host:'rutas.example',origin:'https://otro.example','x-forwarded-host':'otro.example','x-forwarded-proto':'https'})),false);
});
test('rechaza solicitudes que el navegador identifica como cross-site',()=>{
  assert.equal(isAllowedOrigin(request({host:'localhost:3000',origin:'http://localhost:3000','sec-fetch-site':'cross-site'})),false);
});
test('permite clientes sin Origin y compara con la URL si no hay Host',()=>{
  assert.equal(isAllowedOrigin(request({})),true);
  assert.equal(isAllowedOrigin(request({origin:'http://0.0.0.0:3000'})),true);
});
