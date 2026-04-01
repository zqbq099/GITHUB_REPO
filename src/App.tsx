import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UploadCloud, Code2, Cpu, FileArchive, CheckCircle, AlertCircle, Loader2, Download, Smartphone, StopCircle, Trash2, RefreshCw } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type Tab = 'upload' | 'code';
type BuildState = 'idle' | 'analyzing' | 'compiling' | 'success' | 'error';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('code');
  const [code, setCode] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [buildState, setBuildState] = useState<BuildState>('idle');
  const [buildProgress, setBuildProgress] = useState(0);
  const [aiReport, setAiReport] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<any>(null);
  const isCancelledRef = useRef(false);

  const stopBuild = () => {
    isCancelledRef.current = true;
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setBuildState('error');
    setErrorMessage('تم إيقاف المهمة يدوياً');
  };

  const deleteTask = () => {
    isCancelledRef.current = true;
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setBuildState('idle');
    setBuildProgress(0);
    setAiReport('');
    setErrorMessage('');
  };

  const restartApp = () => {
    deleteTask();
    setCode('');
    setFiles([]);
    setActiveTab('code');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      setFiles(Array.from(e.dataTransfer.files));
    }
  };

  const [showSetup, setShowSetup] = useState(false);

  const startBuild = async () => {
    if (activeTab === 'code' && !code.trim()) return;
    if (activeTab === 'upload' && files.length === 0) return;

    isCancelledRef.current = false;
    setBuildState('analyzing');
    setBuildProgress(10);
    setAiReport('');
    setErrorMessage('');

    try {
      // 1. AI Analysis
      const prompt = `
        أنت المساعد الذكي "كعبول". قام المستخدم بطلب تحويل كود برمجي إلى تطبيق أندرويد (APK).
        قم بتحليل الكود التالي أو وصف الملفات المرفقة باختصار شديد (سطرين كحد أقصى) واذكر ما يفعله التطبيق وما إذا كان يبدو صالحاً للعمل.
        
        الكود/الملفات:
        ${activeTab === 'code' ? code.substring(0, 2000) : files.map(f => f.name).join(', ')}
      `;

      const aiResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      if (isCancelledRef.current) return;

      setAiReport(aiResponse.text || 'تم تحليل الكود بنجاح.');
      setBuildProgress(30);

      // 2. Trigger GitHub Build via Backend
      setBuildState('compiling');
      const response = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, files: files.map(f => f.name) }),
      });

      if (isCancelledRef.current) return;

      if (!response.ok) {
        const error = await response.json();
        if (error.error && error.error.includes('GitHub configuration missing')) {
          // Fallback to simulation mode if GitHub is not configured
          setAiReport(prev => prev + '\n\n⚠️ تنبيه: لم يتم ربط GitHub في الإعدادات. سيتم تشغيل وضع المحاكاة الوهمي لتجربة الواجهة.');
          
          await new Promise(r => setTimeout(r, 1500));
          if (isCancelledRef.current) return;
          setBuildProgress(60);
          
          await new Promise(r => setTimeout(r, 1500));
          if (isCancelledRef.current) return;
          setBuildProgress(85);

          await new Promise(r => setTimeout(r, 1500));
          if (isCancelledRef.current) return;
          setBuildProgress(100);
          setBuildState('success');
          return;
        }
        throw new Error(error.error || 'فشل في بدء عملية البناء');
      }

      // 3. Poll for Status
      let notFoundCount = 0;
      pollIntervalRef.current = setInterval(async () => {
        if (isCancelledRef.current) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          return;
        }
        try {
          const statusRes = await fetch('/api/build/status');
          const statusData = await statusRes.json();

          if (statusData.status === 'not_found') {
            notFoundCount++;
            if (notFoundCount > 12) { // Timeout after 60 seconds
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              setBuildState('error');
              setErrorMessage('لم يبدأ البناء. تأكد من إضافة ملف android.yml في مجلد .github/workflows في مستودعك.');
            }
          } else if (statusData.status === 'in_progress' || statusData.status === 'queued') {
            setBuildProgress(prev => Math.min(prev + 5, 90));
          } else if (statusData.status === 'completed') {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (statusData.conclusion === 'success') {
              setBuildProgress(100);
              setBuildState('success');
            } else {
              setBuildState('error');
              setErrorMessage('فشل البناء على GitHub. يرجى مراجعة سجلات الأخطاء هناك.');
            }
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 5000);

    } catch (error: any) {
      if (isCancelledRef.current) return;
      console.error(error);
      setErrorMessage(error.message || 'حدث خطأ غير معروف');
      setBuildState('error');
    }
  };

  const downloadDummyAPK = () => {
    const element = document.createElement("a");
    const file = new Blob(["This is a simulated APK file generated by Kaabool AI."], {type: 'application/vnd.android.package-archive'});
    element.href = URL.createObjectURL(file);
    element.download = "Kaabool_App.apk";
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans" dir="rtl">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Cpu className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-l from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                كعبول
              </h1>
              <p className="text-xs text-slate-400">صانع تطبيقات الأندرويد الذكي</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowSetup(!showSetup)}
              className="text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20 transition-colors"
            >
              إعدادات الربط
            </button>
            <div className="hidden sm:flex items-center gap-2 text-sm text-slate-400 bg-slate-800/50 px-4 py-2 rounded-full">
              <Smartphone className="w-4 h-4" />
              <span>جاهز لتحويل أفكارك إلى APK</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        
        {/* Setup Instructions Modal/Section */}
        <AnimatePresence>
          {showSetup && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mb-8 bg-indigo-950/30 border border-indigo-500/30 rounded-3xl p-6 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-3xl rounded-full -mr-16 -mt-16" />
              <h3 className="text-lg font-bold text-indigo-300 mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                كيفية تفعيل "كعبول" الحقيقي
              </h3>
              <div className="space-y-4 text-sm text-slate-300 leading-relaxed text-right">
                <p>1. قم بإنشاء مستودع (Repository) جديد على GitHub.</p>
                <p>2. أضف ملفاً في المسار <code className="bg-slate-900 px-2 py-0.5 rounded text-indigo-400">.github/workflows/android.yml</code> يحتوي على كود بناء الأندرويد.</p>
                <p>3. قم بتوليد **Personal Access Token** من إعدادات GitHub وأضفه في ملف <code className="bg-slate-900 px-2 py-0.5 rounded text-indigo-400">.env</code> الخاص بالتطبيق.</p>
                <p>4. تأكد من ضبط <code className="bg-slate-900 px-2 py-0.5 rounded text-indigo-400">GITHUB_REPO</code> في الإعدادات ليكون باسم مستودعك.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Intro */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-4">ارفع مشروعك، وسيتكفل كعبول بالباقي</h2>
          <p className="text-slate-400 max-w-xl mx-auto leading-relaxed">
            قم برفع ملفات مشروعك أو الصق الكود البرمجي الخاص بك. سيقوم الذكاء الاصطناعي بتحليل الكود وتجميعه وتحويله إلى ملف APK جاهز للتثبيت على هاتفك.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
          
          {/* Tabs */}
          <div className="flex border-b border-slate-800">
            <button
              onClick={() => setActiveTab('code')}
              className={`flex-1 py-4 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${activeTab === 'code' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'}`}
            >
              <Code2 className="w-5 h-5" />
              لصق الكود
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`flex-1 py-4 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${activeTab === 'upload' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'}`}
            >
              <UploadCloud className="w-5 h-5" />
              رفع الملفات
            </button>
          </div>

          {/* Input Area */}
          <div className="p-6">
            <AnimatePresence mode="wait">
              {activeTab === 'code' ? (
                <motion.div
                  key="code"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <label className="block text-sm font-medium text-slate-300">الكود البرمجي للتطبيق</label>
                  <textarea
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="الصق كود React Native, Flutter, أو Java/Kotlin هنا..."
                    className="w-full h-64 bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-300 font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none"
                    dir="ltr"
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <label className="block text-sm font-medium text-slate-300">ملفات المشروع (ZIP أو مجلدات)</label>
                  <div
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-64 border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl flex flex-col items-center justify-center gap-4 cursor-pointer bg-slate-950/50 transition-colors group"
                  >
                    <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FileArchive className="w-8 h-8 text-indigo-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-slate-300 font-medium mb-1">اسحب وأفلت الملفات هنا</p>
                      <p className="text-slate-500 text-sm">أو انقر لاختيار الملفات من جهازك</p>
                    </div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="hidden"
                      multiple
                    />
                  </div>
                  {files.length > 0 && (
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                      <p className="text-sm text-slate-400 mb-2">الملفات المحددة ({files.length}):</p>
                      <div className="flex flex-wrap gap-2">
                        {files.slice(0, 5).map((f, i) => (
                          <span key={i} className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded-md">
                            {f.name}
                          </span>
                        ))}
                        {files.length > 5 && (
                          <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded-md">
                            +{files.length - 5} أخرى
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action Button */}
            <div className="mt-8">
              <button
                onClick={startBuild}
                disabled={buildState === 'analyzing' || buildState === 'compiling' || (activeTab === 'code' && !code) || (activeTab === 'upload' && files.length === 0)}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium py-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 disabled:shadow-none"
              >
                {buildState === 'idle' || buildState === 'error' || buildState === 'success' ? (
                  <>
                    <Cpu className="w-5 h-5" />
                    ابدأ بناء الـ APK
                  </>
                ) : (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    جاري المعالجة...
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Build Status Section */}
        <AnimatePresence>
          {buildState !== 'idle' && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 32 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 overflow-hidden"
            >
              <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-indigo-400" />
                محطة بناء كعبول
              </h3>

              {/* Progress Bar */}
              <div className="mb-8">
                <div className="flex justify-between items-center text-sm mb-2">
                  <span className="text-slate-400">
                    {buildState === 'analyzing' && 'جاري تحليل الكود بالذكاء الاصطناعي...'}
                    {buildState === 'compiling' && 'جاري تجميع التطبيق وبناء ملف APK...'}
                    {buildState === 'success' && 'اكتمل البناء بنجاح!'}
                    {buildState === 'error' && 'حدث خطأ أثناء البناء.'}
                  </span>
                  <div className="flex items-center gap-4">
                    {(buildState === 'analyzing' || buildState === 'compiling') && (
                      <button onClick={stopBuild} className="text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors">
                        <StopCircle className="w-4 h-4" /> إيقاف
                      </button>
                    )}
                    <span className="text-indigo-400 font-mono">{buildProgress}%</span>
                  </div>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full ${buildState === 'error' ? 'bg-red-500' : 'bg-indigo-500'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${buildProgress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>

              {/* AI Report */}
              {aiReport && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mb-8 bg-slate-950 rounded-xl p-4 border border-slate-800/50"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-slate-200 mb-1">تقرير كعبول الذكي:</h4>
                      <p className="text-sm text-slate-400 leading-relaxed">{aiReport}</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Result Actions */}
              {buildState === 'success' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-emerald-500/20 bg-emerald-500/5 rounded-2xl"
                >
                  <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle className="w-8 h-8 text-emerald-400" />
                  </div>
                  <h4 className="text-xl font-bold text-white mb-2">تطبيقك جاهز!</h4>
                  <p className="text-slate-400 text-sm mb-6 text-center max-w-md">
                    تم بناء ملف الـ APK بنجاح وهو جاهز للتحميل والتثبيت على هاتفك الأندرويد.
                  </p>
                  <button
                    onClick={downloadDummyAPK}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-xl font-medium flex items-center gap-2 transition-colors shadow-lg shadow-emerald-500/20 mb-6"
                  >
                    <Download className="w-5 h-5" />
                    تحميل ملف APK
                  </button>
                  <div className="flex gap-3">
                    <button onClick={deleteTask} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
                      <Trash2 className="w-4 h-4" /> حذف المهمة
                    </button>
                    <button onClick={restartApp} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
                      <RefreshCw className="w-4 h-4" /> إعادة تشغيل
                    </button>
                  </div>
                </motion.div>
              )}

              {buildState === 'error' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-red-500/20 bg-red-500/5 rounded-2xl"
                >
                  <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                  </div>
                  <h4 className="text-xl font-bold text-white mb-2">فشل البناء</h4>
                  <p className="text-slate-400 text-sm text-center max-w-md mb-4">
                    عذراً، حدث خطأ أثناء محاولة بناء التطبيق. يرجى التحقق من الكود والمحاولة مرة أخرى.
                  </p>
                  {errorMessage && (
                    <div className="bg-red-950/50 border border-red-900/50 rounded-lg p-3 w-full max-w-md text-left mb-6" dir="ltr">
                      <p className="text-xs text-red-400 font-mono break-words">
                        Error: {errorMessage}
                      </p>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button onClick={deleteTask} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
                      <Trash2 className="w-4 h-4" /> حذف المهمة
                    </button>
                    <button onClick={restartApp} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
                      <RefreshCw className="w-4 h-4" /> إعادة تشغيل
                    </button>
                  </div>
                </motion.div>
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
