$SRC = "C:\Users\adria\.gemini\antigravity\brain\b3ee00c2-d5bb-4de6-9ab5-2e2131a8b298"
$DST = [Environment]::GetFolderPath("Desktop") + "\KelionAI_Inception_Episodes"
$FF = "C:\Users\adria\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin\ffmpeg.exe"

# Using PNG screenshots (works with ffmpeg, unlike animated webp)
$eps = @(
  @("media__1774112515062.png","EP01 KelionAI Overview","The AI platform architecture and dashboard overview","kelionai.app"),
  @("kelion_final_response_1774119465138.png","EP02 First Chat with Kelion","Testing Kelion AI first response and personality","kelionai.app"),
  @("media__1774122787723.png","EP03 Inception Phase 1 Planning","Designing the self-awareness architecture","kelionai.app"),
  @("media__1774122952885.png","EP04 Railway Cloud Deployment","Deploying Kelion to production servers","kelionai.app"),
  @("kelion_chat_response_1774124514403.png","EP05 AI Tool Discovery","Kelion discovers and saves tools autonomously","kelionai.app"),
  @("media__1774125494559.png","EP06 Phase 2 Write and Deploy","SHA-256 verified file writing pipeline","kelionai.app"),
  @("media__1774126314198.png","EP07 GitHub API Auto-Deploy","Kelion pushes code to GitHub automatically","kelionai.app"),
  @("media__1774127086088.png","EP08 Phase 3 Diagnostics","AI reads logs and runs its own test suite","kelionai.app"),
  @("kelion_supreme_test_response_1774132538374.png","EP09 Antigravity Meets Kelion","Two AIs interact on the live platform","kelionai.app"),
  @("kelion_final_response_subtitle_1774133645807.png","EP10 SUPREME TEST Self-Modification","Kelion modifies its own brain source code LIVE","kelionai.app")
)

$n = 0
foreach ($e in $eps) {
  $n++
  $in = "$SRC\$($e[0])"
  $out = "$DST\EP$($n.ToString('00')).mp4"
  if (!(Test-Path $in)) { Write-Host "SKIP $($e[0])"; continue }
  Write-Host "[$n/10] $($e[1])..."
  
  & $FF -y -loop 1 -i $in -f lavfi -i anullsrc=r=44100:cl=stereo `
    -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,drawtext=text='$($e[1])':fontsize=32:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-200,drawtext=text='$($e[2])':fontsize=22:fontcolor=yellow:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-150,drawtext=text='$($e[3])':fontsize=28:fontcolor=cyan:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-100,drawtext=text='KelionAI Inception Series':fontsize=18:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=50" `
    -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p `
    -c:a aac `
    -t 15 `
    $out 2>&1 | Out-Null
    
  if (Test-Path $out) { Write-Host "  OK $([math]::Round((Get-Item $out).Length/1MB,1))MB" } else { Write-Host "  FAIL" }
}
Write-Host "`nDONE! $DST"
