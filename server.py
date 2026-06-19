import os
import json
import base64
import http.server
import socketserver

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_POST(self):
        if self.path == '/api/export':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                filename = data.get('filename')
                base64_data = data.get('base64Data')
                
                if not filename or not base64_data:
                    self.send_error_response(400, "Missing filename or base64Data")
                    return
                
                # Decode base64
                file_bytes = base64.b64decode(base64_data)
                
                # Ensure exports directory exists
                exports_dir = os.path.join(DIRECTORY, 'exports')
                if not os.path.exists(exports_dir):
                    os.makedirs(exports_dir)
                
                file_path = os.path.join(exports_dir, filename)
                with open(file_path, 'wb') as f:
                    f.write(file_bytes)
                
                # Respond with success and download URL
                response = {
                    "status": "success",
                    "url": f"/exports/{filename}"
                }
                self.send_json_response(200, response)
            except Exception as e:
                self.send_error_response(500, str(e))
        else:
            self.send_error_response(404, "Not Found")

    def send_json_response(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def send_error_response(self, status_code, message):
        self.send_json_response(status_code, {"status": "error", "message": message})

    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    # Allow reuse of address to prevent "address already in use" errors on restart
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"Serving HTTP on port {PORT} with Custom Handler...")
        httpd.serve_forever()
