import os
import base64
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# 1. Initialize Flask app (This is the top-level 'app' Vercel is looking for)
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)  # This handles all the CORS options and methods automatically

DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Serverless constraint: Vercel filesystems are read-only. 
# The only folder allowed to temporarily write data is '/tmp'.
if os.environ.get('VERCEL'):
    EXPORTS_DIR = '/tmp/exports'
else:
    EXPORTS_DIR = os.path.join(DIRECTORY, 'exports')

@app.route('/api/export', methods=['POST'])
def export_file():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "Invalid JSON data"}), 400
            
        filename = data.get('filename')
        base64_data = data.get('base64Data')
        
        if not filename or not base64_data:
            return jsonify({"status": "error", "message": "Missing filename or base64Data"}), 400
        
        # Decode base64 bytes
        file_bytes = base64.b64decode(base64_data)
        
        # Ensure the target directory exists
        if not os.path.exists(EXPORTS_DIR):
            os.makedirs(EXPORTS_DIR)
            
        file_path = os.path.join(EXPORTS_DIR, filename)
        with open(file_path, 'wb') as f:
            f.write(file_bytes)
            
        return jsonify({
            "status": "success",
            "url": f"/exports/{filename}"
        }), 200
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# Route to safely serve your exported file back for downloading
@app.route('/exports/<filename>', methods=['GET'])
def get_exported_file(filename):
    return send_from_directory(EXPORTS_DIR, filename)

# Route to serve your main web pages locally (index.html, etc.)
@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

if __name__ == '__main__':
    # This allows you to still test locally by running: python server.py
    app.run(port=8000, debug=True)