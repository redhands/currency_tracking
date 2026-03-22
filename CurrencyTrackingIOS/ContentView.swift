import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color(red: 0.94, green: 0.90, blue: 0.84)
                .ignoresSafeArea()

            ExchangeDashboardWebView()
        }
    }
}
