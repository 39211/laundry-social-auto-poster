# Daily progress task runner (silent)
Set-Location 'C:\Users\cyc39\Documents\New project 5'
$d = (Get-Date).ToString('yyyy-MM-dd')
python scripts\daily_progress.py $d *>> output\daily-progress-task.log
python scripts\level1_gates.py --root 'C:\Users\cyc39\laundry-repo' *>> output\level1-gates-task.log
