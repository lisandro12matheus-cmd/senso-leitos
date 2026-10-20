# SENSO DE LEITOS

Protótipo estático e navegável para apresentar um fluxo simples de disponibilidade de leitos. Inclui dados fictícios de três hospitais de Belém, entradas e saídas de pacientes, status de higienização e manutenção, painel para SAMU e exportação de planilha.

## Rodar no XAMPP

O projeto não usa PHP, MySQL nem servidor de aplicação. Para testar as telas no seu computador, instale o Node.js e, no PowerShell, execute:

~~~powershell
cd C:\xampp\htdocs\leito-vivo
npm install
npm run dev
~~~

Abra o endereço local mostrado no terminal (normalmente http://localhost:5173). Para preparar a versão estática para o Apache do XAMPP:

~~~powershell
npm run build
~~~

Depois abra http://localhost/leito-vivo/. A pasta compilada fica em dist/; o arquivo .htaccess direciona a página inicial do Apache para essa pasta.

## Publicar no GitHub e Vercel

Suba o conteúdo desta pasta para um repositório. Na Vercel, selecione **Other** (ou Vite), use npm run build como comando de build e dist como diretório de saída. O projeto usa caminhos relativos e rotas com hash, então funciona publicado na raiz ou em uma subpasta.

## O que a amostra demonstra

- HPSM Guamá, HPSM Mario Pinotti e HRD Vicente Zico, com capacidades diferentes e leitos organizados em quatro blocos.
- Painel geral e mapa por status: disponível, ocupado, reservado, higienização, manutenção ou bloqueado.
- Entrada com dados básicos, motivo, origem, código de procedimento e seleção do leito.
- Saída com alta, transferência externa, evasão, óbito ou outro motivo; após a saída, o leito aguarda higienização.
- Manutenção: concluir o serviço envia o leito para higienização; somente depois ele volta a ficar disponível.
- Busca de internações, lista de pacientes, histórico de movimentações e exportação CSV compatível com planilhas.
- Consulta SAMU sem nomes ou documentos de pacientes, com aviso quando a situação precisa ser reconferida.
- Salvamento automático no armazenamento local deste navegador e botão para restaurar os exemplos.

Os dados são fictícios e ficam somente no navegador usado para a demonstração. Não há login, banco central, comunicação entre usuários ou integração com hospitais/SAMU. A tela SAMU é apenas uma simulação e não deve orientar encaminhamentos reais.


