export default function ApiRootPage() {
  return (
    <div>
      <h1 style={{ color: "#10B981" }}>CattleVision API Service</h1>
      <p>Servidor de API RESTful, Autenticação JWT e Inferência Neural YOLOv8 ONNX ativo.</p>
      <p>Endpoints disponíveis:</p>
      <ul>
        <li><code>/api/health</code> - Healthcheck</li>
        <li><code>/api/auth/*</code> - Autenticação JWT</li>
        <li><code>/api/animals/*</code> - Gestão do Rebanho</li>
        <li><code>/api/photos/*</code> - Armazenamento e Score IA</li>
        <li><code>/api/admin/*</code> - Painel Administrativo</li>
      </ul>
    </div>
  );
}
