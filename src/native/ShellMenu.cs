using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// Separate STA process: third-party Explorer extensions never run inside Electron.
internal sealed class ShellMenu : Form
{
    private IContextMenu menu;
    private IContextMenu2 menu2;
    private IContextMenu3 menu3;
    private const uint FirstCommand = 1;
    private const uint RenameCommand = 0x7000;

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        try
        {
            if ((args.Length != 2 && !(args.Length == 3 && args[2] == "--diagnostic")) || (args[0] != "item" && args[0] != "background"))
                throw new ArgumentException("Expected item/background and an absolute path.");
            string target = Path.GetFullPath(args[1]);
            if (!File.Exists(target) && !Directory.Exists(target))
                throw new FileNotFoundException("The selected item no longer exists.", target);
            if (args[0] == "background" && !Directory.Exists(target))
                throw new ArgumentException("A background menu requires a folder.");
            Application.EnableVisualStyles();
            using (ShellMenu host = new ShellMenu(args.Length == 3))
                host.ShowMenu(target, args[0] == "background");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private ShellMenu(bool diagnostic)
    {
        Text = "ヨツマド — Windowsメニュー";
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Size = new Size(1, 1);
        Location = Cursor.Position;
        Opacity = 0;
        // Visible host for manual / UI automation smoke tests of shell extensions.
        if (diagnostic)
        {
            ShowInTaskbar = true;
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            Size = new Size(360, 90);
            Location = new Point(20, 20);
            Opacity = 1;
        }
    }

    private void ShowMenu(string target, bool background)
    {
        IntPtr pidl = IntPtr.Zero;
        IntPtr hmenu = IntPtr.Zero;
        IShellFolder parent = null;
        IShellFolder folder = null;
        object context = null;
        try
        {
            uint attributes;
            Marshal.ThrowExceptionForHR(SHParseDisplayName(target, IntPtr.Zero, out pidl, 0, out attributes));
            Guid folderId = typeof(IShellFolder).GUID;
            IntPtr child;
            Marshal.ThrowExceptionForHR(SHBindToParent(pidl, ref folderId, out parent, out child));
            Guid menuId = typeof(IContextMenu).GUID;
            if (background)
            {
                Marshal.ThrowExceptionForHR(parent.BindToObject(child, IntPtr.Zero, ref folderId, out folder));
                Marshal.ThrowExceptionForHR(folder.CreateViewObject(Handle, ref menuId, out context));
            }
            else
            {
                Marshal.ThrowExceptionForHR(parent.GetUIObjectOf(Handle, 1, new[] { child }, ref menuId, IntPtr.Zero, out context));
            }
            menu = (IContextMenu)context;
            menu2 = context as IContextMenu2;
            menu3 = context as IContextMenu3;
            hmenu = CreatePopupMenu();
            if (hmenu == IntPtr.Zero) throw new InvalidOperationException("Could not create the Windows menu.");
            // Rename needs the file view's inline editor. Offer our own instead of CMF_CANRENAME.
            uint flags = (ModifierKeys & Keys.Shift) != 0 ? 0x100u : 0u;
            Marshal.ThrowExceptionForHR(menu.QueryContextMenu(hmenu, 0, FirstCommand, 0x6fff, flags));
            if (!background)
            {
                AppendMenu(hmenu, 0x800, UIntPtr.Zero, null);
                AppendMenu(hmenu, 0, new UIntPtr(RenameCommand), "名前の変更(&M)");
            }
            Show();
            SetForegroundWindow(Handle);
            Point point = Cursor.Position;
            uint command = TrackPopupMenuEx(hmenu, 0x100 | 0x2, point.X, point.Y, Handle, IntPtr.Zero);
            if (command == RenameCommand)
            {
                Console.WriteLine("rename");
                return;
            }
            if (command == 0) return;
            if (!background && Directory.Exists(target))
            {
                IntPtr verbBuffer = Marshal.AllocHGlobal(1024);
                try
                {
                    Marshal.WriteInt16(verbBuffer, 0);
                    if (menu.GetCommandString(new UIntPtr(command - FirstCommand), 4, IntPtr.Zero, verbBuffer, 512) == 0)
                    {
                        string verb = Marshal.PtrToStringUni(verbBuffer);
                        if (verb == "open" || verb == "explore") { Console.WriteLine("open"); return; }
                    }
                }
                finally { Marshal.FreeHGlobal(verbBuffer); }
            }
            CMINVOKECOMMANDINFOEX invoke = new CMINVOKECOMMANDINFOEX();
            invoke.cbSize = Marshal.SizeOf(typeof(CMINVOKECOMMANDINFOEX));
            // Unicode + synchronous invocation so the host survives in-process operations.
            invoke.fMask = 0x4000 | 0x100 | 0x20000000;
            invoke.hwnd = Handle;
            invoke.lpVerb = new IntPtr(command - FirstCommand);
            invoke.lpVerbW = invoke.lpVerb;
            invoke.nShow = 1;
            invoke.ptInvoke = point;
            Marshal.ThrowExceptionForHR(menu.InvokeCommand(ref invoke));
            // Some extensions create modeless dialogs; keep their STA message pump alive.
            while (HasOwnedWindow())
            {
                Application.DoEvents();
                System.Threading.Thread.Sleep(30);
            }
        }
        finally
        {
            if (hmenu != IntPtr.Zero) DestroyMenu(hmenu);
            menu = null; menu2 = null; menu3 = null;
            if (context != null) Marshal.ReleaseComObject(context);
            if (folder != null) Marshal.ReleaseComObject(folder);
            if (parent != null) Marshal.ReleaseComObject(parent);
            if (pidl != IntPtr.Zero) Marshal.FreeCoTaskMem(pidl);
        }
    }

    private bool HasOwnedWindow()
    {
        bool found = false;
        uint process = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        EnumWindows(delegate(IntPtr window, IntPtr unused) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (window != Handle && owner == process && IsWindowVisible(window)) found = true;
            return true;
        }, IntPtr.Zero);
        return found;
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x117 || message.Msg == 0x2b || message.Msg == 0x2c || message.Msg == 0x120)
        {
            IntPtr result;
            if (menu3 != null && menu3.HandleMenuMsg2((uint)message.Msg, message.WParam, message.LParam, out result) == 0)
            { message.Result = result; return; }
            if (menu2 != null && menu2.HandleMenuMsg((uint)message.Msg, message.WParam, message.LParam) == 0)
            { message.Result = IntPtr.Zero; return; }
        }
        base.WndProc(ref message);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CMINVOKECOMMANDINFOEX
    {
        public int cbSize; public uint fMask; public IntPtr hwnd;
        public IntPtr lpVerb, lpParameters, lpDirectory;
        public int nShow; public uint dwHotKey; public IntPtr hIcon;
        public IntPtr lpTitle, lpVerbW, lpParametersW, lpDirectoryW, lpTitleW;
        public Point ptInvoke;
    }

    [ComImport, Guid("000214e6-0000-0000-c000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellFolder
    {
        void ParseDisplayName(); void EnumObjects();
        [PreserveSig] int BindToObject(IntPtr pidl, IntPtr pbc, ref Guid iid, out IShellFolder folder);
        void BindToStorage(); void CompareIDs();
        [PreserveSig] int CreateViewObject(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object result);
        void GetAttributesOf();
        [PreserveSig] int GetUIObjectOf(IntPtr hwnd, uint count, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] pidls, ref Guid iid, IntPtr reserved, [MarshalAs(UnmanagedType.Interface)] out object result);
        void GetDisplayNameOf(); void SetNameOf();
    }

    [ComImport, Guid("000214e4-0000-0000-c000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu
    {
        [PreserveSig] int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
        [PreserveSig] int InvokeCommand(ref CMINVOKECOMMANDINFOEX invoke);
        [PreserveSig] int GetCommandString(UIntPtr id, uint flags, IntPtr reserved, IntPtr text, uint max);
    }

    [ComImport, Guid("000214f4-0000-0000-c000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu2
    {
        [PreserveSig] int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
        [PreserveSig] int InvokeCommand(ref CMINVOKECOMMANDINFOEX invoke);
        [PreserveSig] int GetCommandString(UIntPtr id, uint flags, IntPtr reserved, IntPtr text, uint max);
        [PreserveSig] int HandleMenuMsg(uint message, IntPtr wparam, IntPtr lparam);
    }

    [ComImport, Guid("bcfce0a0-ec17-11d0-8d10-00a0c90f2719"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu3
    {
        [PreserveSig] int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
        [PreserveSig] int InvokeCommand(ref CMINVOKECOMMANDINFOEX invoke);
        [PreserveSig] int GetCommandString(UIntPtr id, uint flags, IntPtr reserved, IntPtr text, uint max);
        [PreserveSig] int HandleMenuMsg(uint message, IntPtr wparam, IntPtr lparam);
        [PreserveSig] int HandleMenuMsg2(uint message, IntPtr wparam, IntPtr lparam, out IntPtr result);
    }

    private delegate bool EnumWindowProc(IntPtr window, IntPtr data);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern int SHParseDisplayName(string name, IntPtr bind, out IntPtr pidl, uint attributes, out uint result);
    [DllImport("shell32.dll")] private static extern int SHBindToParent(IntPtr pidl, ref Guid iid, out IShellFolder parent, out IntPtr child);
    [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenu(IntPtr menu, uint flags, UIntPtr id, string text);
    [DllImport("user32.dll")] private static extern uint TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr hwnd, IntPtr parameters);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
}
