# Checklist de acessibilidade — componentes isolados

- status de reconciliação possui texto e `role=status`, não apenas cor;
- conflito usa `role=alertdialog`, título associado e única ação segura de releitura;
- tabelas possuem cabeçalho semântico;
- texto vindo de eventos, usuários ou integrações é escapado;
- drift bloqueia ações de estoque no view-model;
- resolução de exceção não é disponibilizada sem evidência;
- foco, fechamento por teclado e anúncio do resultado devem ser validados novamente
  quando os componentes forem inseridos em `suprimentos.html`;
- contraste, zoom 200%, leitor de tela e ordem de tabulação pertencem ao Gate de UI e
  não podem ser aprovados apenas pelos testes de string do RC1.
