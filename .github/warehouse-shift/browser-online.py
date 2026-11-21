"""Play a shift across two Chromium contexts using the local game and Wrangler."""
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ORIGIN = "http://127.0.0.1:8000"
GAME = ORIGIN + "/tools/warehouse-shift.html"
RELAY = "http://127.0.0.1:" + os.environ.get("RELAY_PORT", "8787")
LOGIN = """localStorage.setItem('toolbox.signedIn.area20','STEPHEN');
localStorage.setItem('ws-helped','1'); localStorage.setItem('ws-sound','off');"""
PADS = """window.testPads = [0,1].map(index => ({index, connected:true, mapping:'standard',
  axes:[0,0,0,0], buttons:Array.from({length:17}, () => ({pressed:false,value:0}))}));
Object.defineProperty(navigator,'getGamepads',{value:() => testPads});"""


def open_game(browser, errors, *, phone=False, online=True):
    context = browser.new_context(viewport={"width": 880 if phone else 1000, "height": 470},
                                  has_touch=phone, is_mobile=phone, device_scale_factor=1, service_workers="block")
    context.route("**/*", lambda route: route.continue_() if urlsplit(route.request.url).hostname == "127.0.0.1" else route.abort())
    context.add_init_script(LOGIN)
    if not online:
        context.add_init_script(PADS)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(error.stack or str(error)))
    page.goto(GAME + ("?online=1&relay=" + RELAY if online else ""), wait_until="domcontentloaded")
    page.wait_for_function("!!window.__shift || !!document.getElementById('msgText').textContent", timeout=100_000)
    assert page.evaluate("!!window.__shift"), page.locator("#msgText").text_content()
    return page


def shared_shift(browser, errors):
    host = open_game(browser, errors)
    host.locator("#nameIn").fill("Morgan")
    host.locator("#onlineBtn").click()
    host.locator("#hostRoom").click()
    host.locator("#roomBtn").wait_for()
    code = host.locator("#roomBtn").text_content()[:6]
    host.evaluate("for (const job of __shift.prio()) job.on = false")
    guest = open_game(browser, errors, phone=True)
    guest.locator("#onlineBtn").tap()
    guest.locator("#roomCode").fill(code)
    guest.locator("#joinRoom").tap()
    guest.wait_for_function("!roomBtn.hidden && roomBtn.textContent.includes('2/4')", timeout=60_000)
    assert guest.evaluate("__shift.crew.length") == 0
    assert host.evaluate("__shift.crew.length") == 1

    # Find a real delivery, mirror its original empty shelf, then put it into its labelled destination.
    carton = host.evaluate("""() => {
      const day = __shift.day(), src = day.deliveryLeft()[0].src, c = day.paTake(src,'p1');
      return {id:c.id, sku:c.item.code, dest:c.loc.code};
    }""")
    guest.wait_for_function("""d => {
      const c = __shift.day().delivery.find(v => v.id === d.id);
      return c.by === 'p1' && c.loc.code === d.dest && c.item.loc === null;
    }""", arg=carton)
    host.evaluate("id => {const d=__shift.day(); d.paPut(d.delivery.find(c=>c.id===id),'p1');}", carton["id"])
    guest.wait_for_function("""d => {
      const item=__shift.world.locs.byCode[d.dest].item;
      return item?.code === d.sku && item.mesh && !item.hidden;
    }""", arg=carton)

    guest.evaluate("""() => {
      const s=__shift, stool=s.world.stools[0], side=stool.x<(s.world.centre.x0+s.world.centre.x1)/2 ? 1 : -1;
      s.me.x=stool.x+side*0.9; s.me.y=stool.y; s.me.yaw=side*Math.PI/2;
      s.me.pitch=Math.atan2(0.25-s.me.eye,0.9); s.applyCam();
    }""")
    guest.get_by_role("button", name="Take stool", exact=False).tap()
    host.wait_for_function("__shift.world.stools[0].by === 'p2'")
    guest.locator("#stepBtn").tap()
    assert guest.evaluate("!!__shift.me.step")
    guest.locator("#stepBtn").tap()

    host.evaluate("""() => {const s=__shift; s.me.y=s.world.start.y-3.1; s.me.yaw=Math.PI; s.applyCam();}""")
    guest.evaluate("""() => {const s=__shift; s.me.x=s.world.start.x; s.me.y=s.world.start.y;
      s.me.yaw=0; s.me.pitch=-0.07; s.applyCam();}""")
    device = guest.context.new_cdp_session(guest)
    for w, h in [(420, 800), (880, 470)]:
        portrait = w < h
        device.send("Emulation.setDeviceMetricsOverride", {
            "width": w, "height": h, "screenWidth": w, "screenHeight": h, "deviceScaleFactor": 1, "mobile": True,
            "screenOrientation": {"type": "portraitPrimary" if portrait else "landscapePrimary", "angle": 0 if portrait else 90},
        })
        guest.wait_for_function("""w => {
          const s=__shift, room=roomBtn.getBoundingClientRect(), stats=chips.getBoundingClientRect();
          return s.players[0].view.w === w && room.bottom <= stats.top && room.width > 0 &&
            !document.querySelector('#stickZone').hidden && s.players[0].view.landscape === (w > 500);
        }""", arg=w)
        if portrait:
            scanner = guest.locator("#scanner").bounding_box()
            assert scanner["x"] > w / 2 and scanner["y"] < h / 8
            assert scanner["height"] <= h * 0.4
    # Wait for the other browser's worker figure to reach the host's new spot.
    host_xy = host.evaluate("[__shift.me.x,__shift.me.y]")
    guest.wait_for_function("""([x,y]) => __shift.S.scene.children.some(o => o.visible &&
      o.isGroup && Math.hypot(o.position.x-x,o.position.z-y) < 0.12)""", arg=host_xy)
    screenshot = os.environ.get("WAREHOUSE_SCREENSHOT")
    if screenshot:
        guest.screenshot(path=Path(screenshot))
    host.context.close()
    guest.context.close()


def split_shift(browser, errors):
    page = open_game(browser, errors, online=False)
    assert page.locator("#onlineBtn").is_hidden()
    page.locator("#twoBtn").click()
    page.evaluate("""() => {
      for (const gp of testPads) {
        gp.buttons[0]={pressed:true,value:1}; __shift.pollPads(0.02);
        gp.buttons[0]={pressed:false,value:0}; __shift.pollPads(0.02);
      }
    }""")
    page.locator("#joinGo").click()
    assert page.evaluate("""() => {
      const [a,b]=__shift.players;
      return __shift.split() && a.padIndex===0 && b.padIndex===1 && a.view.x===0 &&
        a.view.x+a.view.w===b.view.x && a.view.y===b.view.y;
    }""")
    page.context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.environ.get("CHROME_BIN"),
            args=["--no-sandbox", "--no-zygote", "--in-process-gpu", "--disable-dev-shm-usage",
                  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        errors = []
        try:
            shared_shift(browser, errors)
            split_shift(browser, errors)
            assert not errors, errors
            print("Rendered host and touch guest, shelf relocation, phone rotation and two-controller split screen passed.")
        finally:
            browser.close()
