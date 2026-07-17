Set-Location $PSScriptRoot
if (Get-Command python -ErrorAction SilentlyContinue) {
    Start-Process python -ArgumentList '-m','http.server','8765' -WorkingDirectory $PSScriptRoot
    Start-Sleep -Milliseconds 700
    Start-Process 'http://localhost:8765'
} else {
    Start-Process (Join-Path $PSScriptRoot 'index.html')
}
