import sys, numpy as np
a=np.fromfile(sys.argv[1],np.float32); b=np.fromfile(sys.argv[2],np.float32); i=np.fromfile(sys.argv[3],np.float32)
ok=np.isfinite(a).all() and np.isfinite(b).all()
d=np.abs(a.astype(np.float64)-b); peak=np.abs(a).max()
rms=lambda x: np.sqrt(np.mean(x.astype(np.float64)**2))
chg=20*np.log10(rms(a-i[:len(a)])/rms(i)+1e-30) if len(i)==len(a) else float('nan')
print(f"{sys.argv[4]:<14} finite={ok} peak={20*np.log10(peak+1e-30):6.1f} dBFS  web-vs-native max diff={d.max():.2e} ({20*np.log10(d.max()/peak+1e-30):7.1f} dB under peak)  change vs input {chg:6.1f} dB")
