import http.server
import socketserver
import os
import webbrowser

PORT = 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
})

print(f"サーバー起動中: http://localhost:{PORT}")
print("終了するには Ctrl+C を押してください")

webbrowser.open(f"http://localhost:{PORT}")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを終了しました")
