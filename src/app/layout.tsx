export const metadata = {
  title: "CattleVision Backend API",
  description: "Serviço de API RESTful e Inferência IA para CattleVision",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "sans-serif", margin: 0, padding: "2rem", background: "#090D16", color: "#fff" }}>
        {children}
      </body>
    </html>
  );
}
