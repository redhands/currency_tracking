import SwiftUI
import WebKit

struct ExchangeDashboardWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(DashboardSchemeHandler(), forURLScheme: "app-assets")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        loadDashboard(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url == nil {
            loadDashboard(in: webView)
        }
    }

    private func loadDashboard(in webView: WKWebView) {
        guard let url = URL(string: "app-assets://dashboard/index.html") else {
            let html = """
            <html>
            <body style="font-family: -apple-system, Apple SD Gothic Neo, sans-serif; background:#efe5d6;">
            <p style="padding:24px;">앱 번들에서 대시보드 파일을 찾을 수 없습니다.</p>
            </body>
            </html>
            """
            webView.loadHTMLString(html, baseURL: nil)
            return
        }

        webView.load(URLRequest(url: url))
    }
}

final class DashboardSchemeHandler: NSObject, WKURLSchemeHandler {
    private let mimeTypes = [
        "html": "text/html; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "js": "application/javascript; charset=utf-8",
        "json": "application/json; charset=utf-8",
    ]
    private let session = URLSession(configuration: .default)

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorBadURL))
            return
        }

        if url.path.hasPrefix("/api/") {
            proxyAPIRequest(for: url, task: urlSchemeTask)
            return
        }

        let requestedPath = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
        let filename = String(requestedPath.dropFirst())
        let parts = filename.split(separator: ".", maxSplits: 1).map(String.init)

        guard parts.count == 2,
              let resourceURL = Bundle.main.url(forResource: parts[0], withExtension: parts[1]),
              let data = try? Data(contentsOf: resourceURL)
        else {
            urlSchemeTask.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
            return
        }

        let mimeType = mimeTypes[parts[1], default: "application/octet-stream"]
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mimeType,
                "Content-Length": String(data.count),
                "Cache-Control": "no-cache",
            ]
        ) ?? URLResponse(
            url: url,
            mimeType: mimeType,
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )

        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func proxyAPIRequest(for url: URL, task: WKURLSchemeTask) {
        guard let upstreamURL = upstreamURL(for: url) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorBadURL))
            return
        }

        session.dataTask(with: upstreamURL) { data, response, error in
            if let error {
                task.didFailWithError(error)
                return
            }

            guard let response, let data else {
                task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorUnknown))
                return
            }

            let contentType = (response as? HTTPURLResponse)?
                .value(forHTTPHeaderField: "Content-Type") ?? "application/json; charset=utf-8"
            let proxiedResponse = HTTPURLResponse(
                url: url,
                statusCode: (response as? HTTPURLResponse)?.statusCode ?? 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": contentType,
                    "Content-Length": String(data.count),
                    "Cache-Control": "no-cache",
                    "Access-Control-Allow-Origin": "*",
                ]
            ) ?? response

            task.didReceive(proxiedResponse)
            task.didReceive(data)
            task.didFinish()
        }.resume()
    }

    private func upstreamURL(for url: URL) -> URL? {
        let path = url.path
        let query = url.query.map { "?\($0)" } ?? ""

        if let frankfurterPath = path.removingPrefix("/api/frankfurter/") {
            return URL(string: "https://api.frankfurter.dev/v1/\(frankfurterPath)\(query)")
        }

        if let exchangeRatePath = path.removingPrefix("/api/exchangerate/") {
            return URL(string: "https://api.exchangerate.host/\(exchangeRatePath)\(query)")
        }

        return nil
    }
}

private extension String {
    func removingPrefix(_ prefix: String) -> String? {
        guard hasPrefix(prefix) else { return nil }
        return String(dropFirst(prefix.count))
    }
}
