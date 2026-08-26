# Pacote de homologação de Suprimentos

## Evidências automatizadas

1. executar `node tests/run-suprimentos.js --json` e arquivar a saída;
2. executar `node suprimentos/tools/readiness-report.js` e arquivar o relatório;
3. executar `node suprimentos/tools/homologation-evidence.js` para consolidar testes,
   Gates e fingerprint do release candidate;
4. capturar metadados do site SharePoint e executar o harness de homologação;
   - runner somente leitura: `SUPRIMENTOS_GRAPH_ACCESS_TOKEN=<runtime> node suprimentos/tools/sharepoint-live-readonly.js`;
   - o token deve existir apenas no ambiente do processo e nunca no perfil, log ou repositório;
   - permissões, escritor único e políticas append-only só entram no snapshot quando o
     perfil indicar `policyAttestation=true` e trouxer `policy.evidenceRef` verificável;
5. alternativa quando o login do Cloud Browser falhar:
   - abrir o Microsoft Graph Explorer no navegador normal e autenticar com a conta da Eletrium;
   - selecionar `POST https://graph.microsoft.com/v1.0/$batch`;
   - usar como corpo `fixtures/sharepoint-graph-explorer-readonly-batch.v1.json`;
   - baixar/copiar apenas o JSON da resposta, sem cabeçalhos, cookies ou token;
   - o lote contém exclusivamente `GET`, lê metadados e no máximo IDs opacos de um item
     por lista; não solicita `fields` nem conteúdo comercial.
5. arquivar fingerprints desejado/observado e plano dry-run;
6. executar corrida de último saldo, fuzzing e reconstrução de 5.000 eventos;
7. injetar 412, paginação quebrada, worker morto, falha antes do commit, ACK perdido e efeito parcial;
8. confirmar que nenhuma chamada Bom Controle ocorreu e que `productionEnabled=false`;
9. comparar arquivos do PR com a lista protegida antes de qualquer integração.

## Critérios humanos

- service account e ownership aprovados;
- permissões do tenant iguais ao contrato, com CRM sem escrita;
- lease/fila de consumidor único escolhido para implantação horizontal;
- operador consegue distinguir conflito, falta e reconciliação pendente;
- Financeiro valida somente o contrato de obrigação, sem assumir estoque;
- equipe de OS valida IDs e comando de consumo sem acoplar sua máquina de estados;
- rollback por compensação e rebuild ensaiado em homologação.

## Únicos itens que exigem ambiente ou outra trilha

- site/listas SharePoint reais, service account e política de segredos;
- teste E2E autenticado com ETag real e lease/fila distribuída;
- delta final de `suprimentos.html`, depois da comparação com CRM/OS;
- estabilização do contrato de consumo da OS;
- evidências do Gate 0 do Bom Controle (chave, schemas, DLP, retry e reconciliação).

Esses itens não bloqueiam evolução ou teste local de SUP-A a SUP-F.
