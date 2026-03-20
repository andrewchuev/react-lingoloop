import LingoLoopReader from "./components/LingoLoopReader.tsx";
import Footer from "./components/Footer.tsx";

export default function App() {
    return <div className="min-h-screen flex flex-col justify-between bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <LingoLoopReader/>
        <Footer/>
    </div>;
}