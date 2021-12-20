cd ..

if [ -f .env ]
then
  export $(cat .env | sed 's/#.*//g' | xargs)
fi

FILE=./test/files/test-removebg.png
node ./cli.js test/files/test.jpg --api-key=$REMOVEBG_API_KEY 

if test -f "$FILE"; then
    echo "Success"
    #rm $FILE
else
    echo ERROR: remove.bg output file $FILE doesn\'t exist
    exit 1
fi
