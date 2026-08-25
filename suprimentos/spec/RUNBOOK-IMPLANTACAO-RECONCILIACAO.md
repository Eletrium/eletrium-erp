# Runbook — implantação, reconciliação e rollback

## Pré-implantação

1. executar `node tests/run-suprimentos.js`;
2. comparar o snapshot SharePoint com `sharepoint-lists.v1.json`;
3. bloquear se houver drift de tipo, concorrência, escritor único ou permissão;
4. ativar somente `shadowMode`; manter Bom Controle produtivo invariavelmente desligado;
5. provisionar service account sem acesso de escrita para CRM;
6. configurar lease/fila distribuída com um consumidor efetivo por partição de material.

## Implantação progressiva

1. dry-run e leitura de 100% das páginas;
2. escrita sintética em listas de homologação;
3. corrida de último saldo com ETag real;
4. piloto-sombra sem promover projeção à interface;
5. liberar escrita para um projeto piloto por feature flag;
6. comparar ledger reconstruído e projeção após cada lote.

## Incidente

- `412`: reler estado integral e devolver conflito; nunca repetir com ETag novo automaticamente;
- timeout antes do envio comprovado: retry com backoff e mesma chave;
- timeout depois do envio ou efeito incerto: `RECONCILIATION_PENDING`, sem retry cego;
- ledger gravado e projeção falhou: reconstruir e atualizar por CAS;
- consumo sem movimento: bloquear fechamento e exigir compensação/evidência;
- paginação incompleta: parar o worker e abrir exceção crítica.

## Rollback

Não excluir eventos. Desligar a feature flag de escrita, drenar comandos já confirmados,
emitir compensações quando o efeito de negócio precisar ser revertido e reconstruir a
projeção. O último passo é arquivar relatório com `Correlation_ID`, eventos originais,
compensações, versões e evidência de reconciliação.

## Critério de retorno

Retomar somente quando projeção e ledger coincidirem, eventos incertos estiverem
reconciliados, ETags forem atuais e a causa raiz tiver evidência. Cor verde na tela não
é evidência — é decoração cara.
